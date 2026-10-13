// fuResolve: re-ubica filas de Follow up por contenido cuando otra persona insertó arriba.
var H = require('./_harness'), eq = H.eq;
var FU = { DATE: 0, CUSTOMER: 1, SIZE: 2, TYPE: 3, TNS: 4, PRICE: 5, ESTADO: 6 };
var cfg = { sheetId: 'x' }, tok = 't';
function normHdr(s) { return (s || '').toString().toLowerCase().trim(); }
var LIVE = [];
function fetch() { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ values: LIVE }); } }); }
eval(H.src(['fuRowId', 'fuResolve']).replace('function fuResolve', 'async function fuResolve'));
function row(c, sz, n, est) { var r = ['01/09/2026', c, sz, 'Runner', '20', '1200', est || '']; r._sheetRow = n; return r; }
var HDR = ['Date', 'Customer', 'Size', 'Type', 'Tns', 'Price', 'Estado'];
(async function () {
  // local: ACME en fila 2; otra persona insertó 3 pedidos arriba -> ahora está en la 5
  var local = [row('ACME', '40/50', 2)];
  LIVE = [HDR, ['01/09/2026', 'N1', '40/50', 'Runner', '20', '1200', ''], ['01/09/2026', 'N2', '40/50', 'Runner', '20', '1200', ''],
    ['01/09/2026', 'N3', '40/50', 'Runner', '20', '1200', ''], ['01/09/2026', 'ACME', '40/50', 'Runner', '20', '1200', 'Inactivo']];
  var res = await fuResolve(local);
  eq(!!res, true, 'encuentra la fila aunque se haya movido');
  eq(local[0]._sheetRow, 5, 'actualiza el numero de fila local');
  eq(res.live[0][6], 'Inactivo', 'devuelve el estado actual de la planilla');
  // pedido que cambió (otro precio) -> null, no escribe
  var l2 = [row('ACME', '40/50', 2)]; l2[0][5] = '999';
  eq(await fuResolve(l2), null, 'si el contenido cambio no se escribe');
  // dos filas identicas: cada una toma la suya
  LIVE = [HDR, ['01/09/2026', 'DUP', '40/50', 'Runner', '20', '1200', ''], ['01/09/2026', 'DUP', '40/50', 'Runner', '20', '1200', '']];
  var d = [row('DUP', '40/50', 2), row('DUP', '40/50', 3)];
  var rd = await fuResolve(d);
  eq(d[0]._sheetRow + ',' + d[1]._sheetRow, '2,3', 'filas identicas no se pisan entre si');
  // fila borrada por otro -> null
  LIVE = [HDR];
  eq(await fuResolve([row('ACME', '40/50', 2)]), null, 'fila borrada por otra persona: se aborta');
  H.done('escrituras seguras');
})();
