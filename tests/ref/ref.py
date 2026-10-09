# tests/ref/ref.py
"""Implementación independiente (Python + scipy) del mismo modelo hidráulico, con las tablas reescritas aparte.
Lee casos.json (redes + resultado del motor JS) y hace dos comprobaciones por red:
  1. Sustituye la solución del motor JS en las ecuaciones de esta implementación (continuidad en cada nodo, energía en cada bomba):
     los residuos tienen que ser ~0.
  2. Resuelve la red desde cero (sin mirar el resultado de JS) con un solver distinto (scipy.optimize.root) y compara cargas y caudales.
La ley de fricción es la de la especificación (README): 64/Re para Re < 2300, interpolación lineal en Re entre 64/2300 y Colebrook(4000)
para 2300 ≤ Re < 4000, Colebrook-White por encima. Como el motor resuelve cada régimen de forma exacta, todas las redes (turbulentas,
de transición y laminares) se comparan con la misma tolerancia estricta; solo se informa cuántas hay de cada tipo."""
import json, math, sys, os
import numpy as np
from scipy.optimize import brentq, root

G = 9.81
# --- tablas reescritas (accesorios: K y curva de apertura; curvas K-apertura de válvulas manuales)
FIT_K = [0.90, 0.45, 0.40, 0.30, 1.00, 0.20, 0.05, 0.35, 10.0, 2.00, 5.00, 0.50, 0.10, 0.20]
FIT_CURVA = {5: 'gate', 6: 'ball', 7: 'butterfly', 8: 'globe'}
CURVAS = {
    'gate':      [(100, 0.20), (90, 0.40), (75, 2), (50, 17), (35, 70), (20, 300), (10, 900)],
    'ball':      [(100, 0.05), (90, 0.08), (75, 0.15), (50, 1.5), (35, 8), (20, 60), (10, 400)],
    'butterfly': [(100, 0.35), (90, 0.65), (75, 2.5), (50, 11), (35, 40), (20, 160), (10, 750)],
    'globe':     [(100, 10), (90, 13), (75, 20), (50, 45), (35, 90), (20, 220), (10, 500)],
}

def k_apertura(curva, pct):
    pts = CURVAS[curva]
    p = min(100.0, max(0.0, pct))
    if p <= 0: return math.inf
    if p >= 100: return pts[0][1]
    for (ph, kh), (pl, kl) in zip(pts, pts[1:]):
        if pl <= p <= ph:
            t = (p - pl) / (ph - pl)
            return 10 ** (math.log10(kl) + t * (math.log10(kh) - math.log10(kl)))
    (pa, ka), (pb, kb) = pts[-2], pts[-1]                       # por debajo de 10 %: misma pendiente log-lineal
    return 10 ** (math.log10(kb) + (math.log10(kb) - math.log10(ka)) / (pb - pa) * (p - pb))

def k_tramo(a):
    k = 0.0
    for i, q in enumerate(a['fitQty']):
        if q <= 0: continue
        if i in FIT_CURVA:
            kv = k_apertura(FIT_CURVA[i], a['fitOpen'][i])
            if math.isinf(kv): return math.inf
            k += q * kv
        else:
            k += q * FIT_K[i]
    k += a.get('customK') or 0
    if a['type'] == 'valve' and a.get('valveType') in CURVAS:
        kv = k_apertura(a['valveType'], a.get('open_pct', 100))
        if math.isinf(kv): return math.inf
        k += kv
    return k

def colebrook(Re, eD):
    F = lambda f: 1 / math.sqrt(f) + 2 * math.log10(eD / 3.7 + 2.51 / (Re * math.sqrt(f)))
    return brentq(F, 0.004, 0.5, xtol=1e-14, rtol=1e-14)

def friccion(Re, eD):
    if Re <= 0: return 0.02                        # sin flujo (el 0,02 que muestra el motor para Re < 1 no entra en la pérdida: la laminar es exacta)
    if Re < 2300: return 64.0 / Re
    if Re < 4000:
        fL, fT = 64.0 / 2300, colebrook(4000, eD)
        return fL + (fT - fL) * (Re - 2300) / (4000 - 2300)
    return colebrook(Re, eD)

def caudal_tramo(dH, a, nu, suave=False):
    """Caudal [m³/h] con signo a partir del salto de carga (resuelve hf(Q) = |dH| por bisección/Brent).
    `suave`: una retención cerrada deja pasar una fuga mínima proporcional (solo para llegar a la solución desde un arranque neutro;
    el resultado se vuelve a resolver y verificar con la retención exacta)."""
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
    eps = (max(0.0, 0.046 if e0 is None else e0) + max(0.0, a.get('fouling_mm') or 0)) / 1000.0     # ε = 0 es un tubo liso; solo la falta del dato usa acero
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
    dpH = max(a['dp_bar'] * 1e5 / (rho * G), 1e-6)
    eff = dH - dpH
    D = (a.get('D_mm') or 200) / 1000.0
    return 3600 * (math.pi * D * D / 4 * 2.0) * math.sqrt(eff / dpH) if eff > 0 else 0.0

def carga_bomba(Q, a):
    pts = sorted(a['pumpCurve'], key=lambda p: p['Q'])
    q = abs(Q)
    if q <= pts[0]['Q']: return pts[0]['H']
    if q >= pts[-1]['Q']:
        pend = (pts[-1]['H'] - pts[-2]['H']) / (pts[-1]['Q'] - pts[-2]['Q'])
        return max(pts[-1]['H'] + pend * (q - pts[-1]['Q']), -0.3 * pts[0]['H'])
    for p0, p1 in zip(pts, pts[1:]):
        if p0['Q'] <= q <= p1['Q']:
            return p0['H'] + (q - p0['Q']) / (p1['Q'] - p0['Q']) * (p1['H'] - p0['H'])

class Red:
    def __init__(self, red):
        self.rho, self.nu = red['fluid']['rho'], red['fluid']['nu']
        self.nodos = {n['id']: n for n in red['nodes']}
        self.arcos = red['arcs']
        self.libres = [n['id'] for n in red['nodes'] if n['type'] == 'junction']
        self.fijos = {n['id']: n['cota'] + (n.get('p_bar') or 0) * 1e5 / (self.rho * G) for n in red['nodes'] if n['type'] == 'tank'}
        self.bombas = [a for a in self.arcos if a['type'] == 'pump' and a.get('pumpMode', 'curve') != 'fixedQ']
        self.idx = {i: k for k, i in enumerate(self.libres)}

    def carga(self, x, nid):
        return self.fijos[nid] if nid in self.fijos else x[self.idx[nid]]

    def caudales(self, x, suave=False):
        """Caudal [m³/h] de cada arco (de→a) para un vector x = [cargas libres..., caudales de bombas...]."""
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
        Q = self.caudales(x, suave); NF = len(self.libres)
        r = []
        for nid in self.libres:
            neto = -(self.nodos[nid].get('demand') or 0)
            for a in self.arcos:
                if a['toId'] == nid: neto += Q[a['id']]
                if a['fromId'] == nid: neto -= Q[a['id']]
            r.append(neto)
        for a in self.bombas:
            if a.get('pumpMode', 'curve') == 'curve':
                r.append(self.carga(x, a['toId']) - self.carga(x, a['fromId']) - carga_bomba(Q[a['id']] / (a.get('nPumps') or 1), a))
            else:   # presión fija a la descarga
                objetivo = self.nodos[a['toId']]['cota'] + a['fixedP_bar'] * 1e5 / (self.rho * G)
                r.append(self.carga(x, a['toId']) - objetivo)
        return np.array(r)

def main():
    ruta = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'casos.json')
    casos = json.load(open(ruta, encoding='utf-8'))
    n_cmp = n_sin = n_alt = n_inv = 0
    por_reg = {'turb': 0, 'trans': 0, 'lam': 0}
    # peor diferencia por régimen: (residuo relativo, dif. de carga [m], dif. relativa de caudal)
    peor = {k: dict(res=0.0, H=0.0, Q=0.0) for k in por_reg}
    LIM = (1e-6, 1e-5, 1e-6)       # misma tolerancia estricta para todos los regímenes
    fallos = []
    for c in casos:
        if 'js' not in c: continue
        red = Red(c['red']); NF = len(red.libres)
        js = c['js']
        # régimen de la red = el menos turbulento de sus tramos con flujo (solo para informar)
        res_arcos = [js['Re'][str(a['id'])] for a in red.arcos if a['type'] in ('pipe', 'check', 'valve') and abs(js['Q'][str(a['id'])]) > 1e-9 and js['Re'][str(a['id'])] > 0]
        reg = 'lam' if any(r < 2300 for r in res_arcos) else ('trans' if any(r < 4000 for r in res_arcos) else 'turb')
        x_js = np.array([js['H'][str(i)] for i in red.libres] + [js['Q'][str(a['id'])] for a in red.bombas])
        escala = max(1.0, max(abs(q) for q in js['Q'].values()))
        res = np.abs(red.residuos(x_js)).max() / escala
        # 2. solución independiente desde cero (scipy.optimize.root). La carga de la bomba depende de |Q|, así que las ecuaciones admiten
        #    además un equilibrio no físico con la bomba a contraflujo: si el solver cae en uno, se reintenta con otros arranques.
        ok, sol, Qpy, inversa = False, None, None, False
        hm = float(np.mean(list(red.fijos.values())))
        for dh, q0 in ((0.0, 50.0), (10.0, 20.0), (25.0, 100.0), (-5.0, 200.0), (40.0, 10.0)):
            x0 = np.array([hm + dh] * NF + [q0] * len(red.bombas))
            previa = root(lambda v: red.residuos(v, True), x0, method='hybr', tol=1e-13)       # 1.º con retenciones suaves, 2.º con las exactas
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
        if res > LIM[0]: fallos.append((c['nombre'], 'residuo de las ecuaciones independientes en la solución de JS = %.2e (límite %.0e)' % (res, LIM[0])))
        if ok and (dH > LIM[1] or dQ > LIM[2]):
            if con_retencion:       # con retenciones puede haber más de un equilibrio válido (el residuo de arriba ya probó que el de JS lo es)
                n_alt += 1
            else:
                fallos.append((c['nombre'], 'otra solución sin retenciones: dif. de carga %.2e m, dif. relativa de caudal %.2e' % (dH, dQ)))
        elif ok:
            p['H'] = max(p['H'], dH); p['Q'] = max(p['Q'], dQ)
        elif not inversa:
            n_sin += 1
    print('Redes comparadas: %d (turbulentas %d · con transición %d · con tramos laminares %d) · sin solución independiente desde cero: %d · con otro equilibrio válido (retenciones): %d'
          % (n_cmp, por_reg['turb'], por_reg['trans'], por_reg['lam'], n_sin, n_alt))
    if n_inv: print('Redes en que el solver independiente solo encontró un equilibrio con la bomba a contraflujo (no físico, descartado; en JS todas las bombas tienen caudal positivo): %d' % n_inv)
    print('El residuo de las ecuaciones independientes se evaluó en TODAS las redes (en la solución de JS); la solución desde cero, en %d. Tolerancia única: residuo %.0e · carga %.0e m · caudal %.0e (relativa).' % (n_cmp - n_sin - n_inv, LIM[0], LIM[1], LIM[2]))
    for k, nombre in (('turb', 'Turbulentas'), ('trans', 'Transición  '), ('lam', 'Laminares   ')):
        if por_reg[k]: print('%s · residuo máx. %.2e · dif. de carga máx. %.2e m · dif. relativa de caudal máx. %.2e' % (nombre, peor[k]['res'], peor[k]['H'], peor[k]['Q']))
    omitidos = [c for c in casos if 'js' not in c]
    if omitidos: print('Redes que el motor JS no resolvió (no se comparan): ' + ', '.join(c['nombre'] for c in omitidos))
    if n_cmp < 20: fallos.append(('general', 'muy pocas redes comparadas (%d)' % n_cmp))
    if por_reg['lam'] + por_reg['trans'] < 3: fallos.append(('general', 'faltan redes laminares/de transición para ejercitar esos regímenes'))
    if n_sin > n_cmp * 0.25: fallos.append(('general', 'el solver independiente no resolvió %d de %d redes' % (n_sin, n_cmp)))
    for nombre, msg in fallos: print('FALLA · %s · %s' % (nombre, msg))
    print('CONTRASTE CON PYTHON: ' + ('FALLA' if fallos else 'OK'))
    sys.exit(1 if fallos else 0)

if __name__ == '__main__':
    main()
