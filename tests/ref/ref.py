# tests/ref/ref.py
"""Implementación independiente (Python + scipy) del modelo hidráulico de Hydra v27, escrita aparte para contraste cruzado:
  - Fricción: 64/Re (Re < 2300), interpolación lineal (2300 ≤ Re < 4000), Colebrook-White (Re ≥ 4000).
  - Accesorios: método Crane TP 410 (K = LeD · fT(D)) o modo 'fixed', y curvas K-apertura calibradas.
  - Equipos: ley cuadrática Kv referenciada a ρ_ref = 998.2 kg/m³ (o modo 'threshold').
  - Bombas: corrección viscosa ANSI/HI 9.6.7 cuando ν > 1.5 cSt y viscCorr != False.
"""
import json, math, sys, os
import numpy as np
from scipy.optimize import brentq, root

G = 9.81
RHO_REF = 998.2
EPS_CRANE_M = 0.00004572

FIT_K   = [0.90, 0.45, 0.40, 0.30, 1.00, 0.20, 0.05, 0.35, 10.0, 2.00, 5.00, 0.50, 0.10, 0.20, 1.00, 0.04]
FIT_LED = {0: 30, 1: 20, 2: 16, 3: 20, 4: 60, 5: 8, 6: 3, 7: 40, 8: 340, 9: 100}
FIT_CURVA = {5: 'gate', 6: 'ball', 7: 'butterfly', 8: 'globe'}
VALVE_LED = {'gate': 8, 'ball': 3, 'butterfly': 40, 'globe': 340}
CURVAS = {
    'gate':      [(100, 0.15), (90, 0.28), (75, 0.60), (50, 2.70), (35, 7.50), (25, 15.3), (10, 120)],
    'ball':      [(100, 0.05), (90, 0.15), (75, 1.20), (67, 5.50), (50, 17.0), (33, 200),  (10, 950)],
    'butterfly': [(100, 0.68), (90, 1.10), (75, 3.30), (50, 14.0), (35, 48.0), (20, 185),  (10, 750)],
    'globe':     [(100, 5.80), (90, 7.50), (75, 11.5), (50, 25.0), (35, 52.0), (20, 130),  (10, 320)],
}

CRANE_FT_BANDS = [
    (17, 0.027), (23, 0.025), (30, 0.023), (37, 0.022), (45, 0.021),
    (57, 0.019), (85, 0.018), (115, 0.017), (140, 0.016), (175, 0.015),
    (275, 0.014), (400, 0.013), (620, 0.012),
]

def crane_ft(d_mm):
    d = d_mm if (d_mm and d_mm > 0) else 52.5
    for lim, ft in CRANE_FT_BANDS:
        if d <= lim:
            return ft
    d_m = d / 1000.0
    ed = min(max(EPS_CRANE_M / d_m, 1e-7), 0.1)
    return 0.25 / (math.log10(ed / 3.7) ** 2)

def k_apertura(curva, pct, d_mm=None, k_method='crane'):
    pts = CURVAS[curva]
    p = min(100.0, max(0.0, pct))
    if p <= 0: return math.inf
    if p >= 100:
        k_base = pts[0][1]
    else:
        k_base = None
        for (ph, kh), (pl, kl) in zip(pts, pts[1:]):
            if pl <= p <= ph:
                t = (p - pl) / (ph - pl)
                k_base = 10 ** (math.log10(kl) + t * (math.log10(kh) - math.log10(kl)))
                break
        if k_base is None:
            (pa, ka), (pb, kb) = pts[-2], pts[-1]
            k_base = 10 ** (math.log10(kb) + (math.log10(kb) - math.log10(ka)) / (pb - pa) * (p - pb))
    if k_method != 'fixed' and d_mm and d_mm > 0 and curva in VALVE_LED:
        k_open = VALVE_LED[curva] * crane_ft(d_mm)
        return k_base * (k_open / pts[0][1])
    return k_base

def k_tramo(a):
    k = 0.0
    km = a.get('kMethod', 'crane')
    d_mm = a.get('D_mm', 200)
    for i, q in enumerate(a.get('fitQty', [])):
        if q <= 0 or i >= len(FIT_K): continue
        if i in FIT_CURVA:
            kv = k_apertura(FIT_CURVA[i], a['fitOpen'][i], d_mm, km)
            if math.isinf(kv): return math.inf
            k += q * kv
        elif km != 'fixed' and i in FIT_LED and d_mm and d_mm > 0:
            k += q * FIT_LED[i] * crane_ft(d_mm)
        else:
            k += q * FIT_K[i]
    k += a.get('customK') or 0
    if a['type'] == 'valve' and a.get('valveType') in CURVAS:
        kv = k_apertura(a['valveType'], a.get('open_pct', 100), d_mm, km)
        if math.isinf(kv): return math.inf
        k += kv
    return k

def colebrook(Re, eD):
    F = lambda f: 1 / math.sqrt(f) + 2 * math.log10(eD / 3.7 + 2.51 / (Re * math.sqrt(f)))
    return brentq(F, 0.004, 0.5, xtol=1e-14, rtol=1e-14)

def friccion(Re, eD):
    if Re <= 0: return 0.02
    if Re < 2300: return 64.0 / Re
    if Re < 4000:
        fL, fT = 64.0 / 2300, colebrook(4000, eD)
        return fL + (fT - fL) * (Re - 2300) / (4000 - 2300)
    return colebrook(Re, eD)

def caudal_tramo(dH, a, nu, suave=False):
    t = a['type']
    if (t == 'check' or (t == 'valve' and a.get('valveType') == 'check')) and dH < 0: return dH * 1e-6 if suave else 0.0
    K = k_tramo(a)
    if math.isinf(K): return 0.0
    es_valvula = t == 'valve'
    L = 0.0 if es_valvula else a['L_m']
    Kef = 0.01 if (es_valvula and K <= 0) else K
    D = a['D_mm'] / 1000.0
    A = math.pi * D * D / 4
    e0 = a.get('eps_mm')
    eps = (max(0.0, 0.046 if e0 is None else e0) + max(0.0, a.get('fouling_mm') or 0)) / 1000.0
    if abs(dH) < 1e-12 or D <= 0 or L < 0 or (L <= 0 and Kef <= 0): return 0.0
    def hf(Qm3s):
        V = Qm3s / A
        f = friccion(V * D / nu, eps / D)
        return (f * L / D + Kef) * V * V / (2 * G)
    adH = abs(dH)
    hi = 1e-3
    while hf(hi) < adH: hi *= 2
    Q = brentq(lambda q: hf(q) - adH, 1e-15, hi, xtol=1e-16, rtol=1e-14)
    return math.copysign(Q * 3600, dH)

def caudal_equipo(dH, a, rho):
    D = (a.get('D_mm') or 200) / 1000.0
    q_nom_ms = (a['q_nom_m3h'] / 3600.0) if (a.get('q_nom_m3h') and a['q_nom_m3h'] > 0) else (math.pi * D * D / 4 * 2.0)
    if a.get('equipMode') == 'threshold':
        dpH = max(a['dp_bar'] * 1e5 / (rho * G), 1e-6)
        eff = dH - dpH
        return 3600 * q_nom_ms * math.sqrt(eff / dpH) if eff > 0 else 0.0
    h_nom = max((a.get('dp_bar') or 0) * 1e5 / (RHO_REF * G), 1e-6)
    if abs(dH) < 1e-12: return 0.0
    return math.copysign(3600 * q_nom_ms * math.sqrt(abs(dH) / h_nom), dH)

def curva_efectiva_bomba(a, nu):
    pts = sorted(a['pumpCurve'], key=lambda p: p['Q'])
    if a.get('viscCorr') is False or nu <= 0 or nu * 1e6 <= 1.5:
        return pts
    nu_cst = nu * 1e6
    # BEP estimado
    p_curve = sorted(a.get('powerCurve') or [], key=lambda p: p['Q'])
    def interp_p(q):
        if len(p_curve) < 2: return None
        if q <= p_curve[0]['Q']: return p_curve[0]['P']
        if q >= p_curve[-1]['Q']: return p_curve[-1]['P']
        for p0, p1 in zip(p_curve, p_curve[1:]):
            if p0['Q'] <= q <= p1['Q']:
                return p0['P'] + (q - p0['Q']) / (p1['Q'] - p0['Q']) * (p1['P'] - p0['P'])
        return None
    best_i, best_m = 0, -1.0
    for i, pt in enumerate(pts):
        if pt['Q'] <= 0 or pt['H'] <= 0: continue
        pw = interp_p(pt['Q'])
        m = (pt['Q'] * pt['H'] / pw) if (pw and pw > 0) else (pt['Q'] * pt['H'])
        if m > best_m: best_m, best_i = m, i
    q_bep = pts[best_i]['Q'] if best_m > 0 else max((pts[-1]['Q'] or 100) * 0.75, 1.0)
    h_bep = pts[best_i]['H'] if best_m > 0 else max(pts[0]['H'] * 0.8, 1.0)
    n_rpm = a.get('speed_rpm') if (a.get('speed_rpm') and a['speed_rpm'] > 0) else 1450.0
    B = 16.5 * (nu_cst ** 0.5) * (max(h_bep, 0.5) ** 0.0625) / ((max(q_bep, 0.5) ** 0.375) * (n_rpm ** 0.25))
    if B <= 1.0:
        return pts
    b_eff = min(B, 40.0)
    c_q = math.exp(-0.165 * (math.log10(b_eff) ** 3.15))
    out = []
    for pt in pts:
        if pt['Q'] <= 0:
            out.append({'Q': 0.0, 'H': pt['H']})
        else:
            q_ratio = min(pt['Q'] / max(q_bep, 1e-6), 1.25)
            ch = max(0.15, min(1.0, 1.0 - (1.0 - c_q) * (q_ratio ** 0.75)))
            out.append({'Q': pt['Q'] * c_q, 'H': pt['H'] * ch})
    return out

def carga_bomba(Q, a, nu):
    pts = curva_efectiva_bomba(a, nu)
    q = abs(Q)
    if q <= pts[0]['Q']: return pts[0]['H']
    if q >= pts[-1]['Q']:
        dq = pts[-1]['Q'] - pts[-2]['Q']
        pend = (pts[-1]['H'] - pts[-2]['H']) / dq if dq > 1e-12 else -0.1
        return max(pts[-1]['H'] + pend * (q - pts[-1]['Q']), -0.3 * pts[0]['H'])
    for p0, p1 in zip(pts, pts[1:]):
        if p0['Q'] <= q <= p1['Q']:
            dq = p1['Q'] - p0['Q']
            return p0['H'] + ((q - p0['Q']) / dq if dq > 1e-12 else 0.0) * (p1['H'] - p0['H'])

class Red:
    def __init__(self, red):
        self.rho, self.nu = red['fluid']['rho'], red['fluid']['nu']
        self.nodos = {n['id']: n for n in red['nodes']}
        self.arcos = red['arcs']
        self.libres = [n['id'] for n in red['nodes'] if n['type'] == 'junction']
        self.fijos = {
            n['id']: (n.get('cota') or 0) + (n.get('level_m') or 0) + (n.get('p_bar') or 0) * 1e5 / (self.rho * G)
            for n in red['nodes'] if n['type'] == 'tank'
        }
        self.bombas = [a for a in self.arcos if a['type'] == 'pump' and a.get('pumpMode', 'curve') != 'fixedQ']
        self.idx = {i: k for k, i in enumerate(self.libres)}

    def carga(self, x, nid):
        return self.fijos[nid] if nid in self.fijos else x[self.idx[nid]]

    def caudales(self, x, suave=False):
        NF = len(self.libres); Q = {}
        for a in self.arcos:
            if a['type'] == 'pump': continue
            dH = self.carga(x, a['fromId']) - self.carga(x, a['toId'])
            Q[a['id']] = caudal_equipo(dH, a, self.rho) if a['type'] == 'equip' else caudal_tramo(dH, a, self.nu, suave)
        for k, a in enumerate(self.bombas): Q[a['id']] = x[NF + k]
        for a in self.arcos:
            if a['type'] == 'pump' and a.get('pumpMode') == 'fixedQ': Q[a['id']] = a.get('fixedQ_m3h', 100)
        return Q

    def residuos(self, x, suave=False):
        Q = self.caudales(x, suave)
        r = []
        for nid in self.libres:
            neto = -(self.nodos[nid].get('demand') or 0)
            for a in self.arcos:
                if a['toId'] == nid: neto += Q[a['id']]
                if a['fromId'] == nid: neto -= Q[a['id']]
            r.append(neto)
        for a in self.bombas:
            if a.get('pumpMode', 'curve') == 'curve':
                r.append(self.carga(x, a['toId']) - self.carga(x, a['fromId']) - carga_bomba(Q[a['id']] / (a.get('nPumps') or 1), a, self.nu))
            else:
                objetivo = (self.nodos[a['toId']].get('cota') or 0) + a['fixedP_bar'] * 1e5 / (self.rho * G)
                r.append(self.carga(x, a['toId']) - objetivo)
        return np.array(r)

def main():
    ruta = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'casos.json')
    casos = json.load(open(ruta, encoding='utf-8'))
    n_cmp = n_sin = n_alt = n_inv = 0
    por_reg = {'turb': 0, 'trans': 0, 'lam': 0}
    peor = {k: dict(res=0.0, H=0.0, Q=0.0) for k in por_reg}
    LIM = (1e-6, 1e-5, 1e-6)
    fallos = []
    for c in casos:
        if 'js' not in c: continue
        red = Red(c['red']); NF = len(red.libres)
        js = c['js']
        res_arcos = [js['Re'][str(a['id'])] for a in red.arcos if a['type'] in ('pipe', 'check', 'valve') and abs(js['Q'][str(a['id'])]) > 1e-9 and js['Re'][str(a['id'])] > 0]
        reg = 'lam' if any(r < 2300 for r in res_arcos) else ('trans' if any(r < 4000 for r in res_arcos) else 'turb')
        x_js = np.array([js['H'][str(i)] for i in red.libres] + [js['Q'][str(a['id'])] for a in red.bombas])
        escala = max(1.0, max(abs(q) for q in js['Q'].values()))
        res = np.abs(red.residuos(x_js)).max() / escala
        ok, sol, Qpy, inversa = False, None, None, False
        hm = float(np.mean(list(red.fijos.values())))
        for dh, q0 in ((0.0, 50.0), (10.0, 20.0), (25.0, 100.0), (-5.0, 200.0), (40.0, 10.0)):
            x0 = np.array([hm + dh] * NF + [q0] * len(red.bombas))
            previa = root(lambda v: red.residuos(v, True), x0, method='hybr', tol=1e-13)
            sol = root(red.residuos, previa.x, method='hybr', tol=1e-13)
            if not (sol.success and np.abs(red.residuos(sol.x)).max() / escala < 1e-9): continue
            Qpy = red.caudales(sol.x)
            if any(Qpy[a['id']] < -1e-9 for a in red.bombas): inversa = True; continue
            ok = True; break
        dH = dQ = None
        if ok:
            dH = max([abs(sol.x[red.idx[i]] - js['H'][str(i)]) for i in red.libres] + [0.0])
            dQ = max([abs(Qpy[a['id']] - js['Q'][str(a['id'])]) / max(1.0, abs(js['Q'][str(a['id'])])) for a in red.arcos])
        n_cmp += 1; por_reg[reg] += 1
        if any(js['Q'][str(a['id'])] < -1e-9 for a in red.bombas): fallos.append((c['nombre'], 'la solución de JS tiene una bomba a contraflujo'))
        if inversa and not ok: n_inv += 1
        con_retencion = any(a['type'] == 'check' or (a['type'] == 'valve' and a.get('valveType') == 'check') for a in red.arcos)
        p = peor[reg]
        p['res'] = max(p['res'], res)
        if res > LIM[0]: fallos.append((c['nombre'], 'residuo = %.2e (límite %.0e)' % (res, LIM[0])))
        if ok and (dH > LIM[1] or dQ > LIM[2]):
            if con_retencion:
                n_alt += 1
            else:
                fallos.append((c['nombre'], 'otra solución sin retenciones: dif. H %.2e m, dif. Q %.2e' % (dH, dQ)))
        elif ok:
            p['H'] = max(p['H'], dH); p['Q'] = max(p['Q'], dQ)
        elif not inversa:
            n_sin += 1
    print('Redes comparadas: %d (turbulentas %d · con transición %d · con tramos laminares %d) · sin solución desde cero: %d · otro equilibrio (retenciones): %d'
          % (n_cmp, por_reg['turb'], por_reg['trans'], por_reg['lam'], n_sin, n_alt))
    for k, nombre in (('turb', 'Turbulentas'), ('trans', 'Transición  '), ('lam', 'Laminares   ')):
        if por_reg[k]: print('%s · residuo máx. %.2e · dif. de carga máx. %.2e m · dif. relativa de caudal máx. %.2e' % (nombre, peor[k]['res'], peor[k]['H'], peor[k]['Q']))
    for nombre, msg in fallos: print('FALLA · %s · %s' % (nombre, msg))
    print('CONTRASTE CON PYTHON: ' + ('FALLA' if fallos else 'OK'))
    sys.exit(1 if fallos else 0)

if __name__ == '__main__':
    main()
