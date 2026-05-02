// ============================================================
// PANEL.JS — LÓGICA COMPLETA DEL PANEL ELEGANCE JEWELRY
// Conecta con /api/dashboard/* en elegance-panel.pages.dev
// ============================================================

const API = '';  // mismo origen, rutas relativas

// ── SEGURIDAD — Token de acceso ────────────────────────────
// 1. Capturar token de la URL (?token=...) si viene en el link
(function capturarToken() {
  const params = new URLSearchParams(window.location.search);
  const tokenURL = params.get('token');
  if (tokenURL) {
    localStorage.setItem('admin_token', tokenURL);
    // Limpiar el token de la barra de direcciones
    params.delete('token');
    const nuevaURL = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
    window.history.replaceState({}, '', nuevaURL);
  }
})();

// 2. Leer token guardado
function getAdminToken() {
  return localStorage.getItem('admin_token') || '';
}

// 3. Override global del fetch — agrega Authorization en todas las llamadas a /api/dashboard/
const _fetchOriginal = window.fetch.bind(window);
window.fetch = function(url, options = {}) {
  if (typeof url === 'string' && url.includes('/api/dashboard/')) {
    const token = getAdminToken();
    if (token) {
      options.headers = {
        ...(options.headers || {}),
        'Authorization': 'Bearer ' + token,
      };
    }
  }
  return _fetchOriginal(url, options);
};

// ── ESTADO GLOBAL ─────────────────────────────────────────
let pedidosOriginales   = [];
let productosOriginales = [];
let filtroEstadoActual  = 'todos';
let pedidoSeleccionado  = null;
let charts              = {};

let filtrosFecha = {
  overview: { tipo:'todo',  desde:'', hasta:'' },
  analisis: { tipo:'todo',  desde:'', hasta:'' },
  clientes: { tipo:'todo',  desde:'', hasta:'' },
  temporal: { tipo:'7dias', desde:'', hasta:'' },
};

const AUTO_REFRESH_MS = 2 * 60 * 1000;

// ── INIT ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  cargarDatos();
  setInterval(cargarDatosConDeteccion, AUTO_REFRESH_MS);
});

// ── CARGA PRINCIPAL ───────────────────────────────────────
async function cargarDatos() {
  mostrarCargando(true);
  try {
    await Promise.all([
      cargarOverview(),
      cargarAnalisis(),
      cargarProductos(),
      cargarClientes(),
      cargarTemporal(),
      cargarPedidos(),
      cargarEntregas(),
    ]);
    document.getElementById('ultimaActualizacion').textContent =
      new Date().toLocaleString('es-PA');
    mostrarToast('Sistema sincronizado', 'success');
  } catch(e) {
    mostrarToast('Error de conexión', 'error');
    console.error(e);
  }
  mostrarCargando(false);
}

async function cargarDatosConDeteccion() {
  const antes = pedidosOriginales.length;
  await cargarPedidos();
  if (pedidosOriginales.length > antes) {
    reproducirCampana();
    mostrarToast('¡NUEVO PEDIDO!', 'success');
  }
  cargarOverview();
  cargarEntregas();
}

function actualizarDatos() { cargarDatos(); }

// ── OVERVIEW / RESUMEN ────────────────────────────────────
async function cargarOverview() {
  const f = filtrosFecha.overview;
  const params = new URLSearchParams({ filtro: f.tipo });
  if (f.tipo === 'rango') { params.set('desde', f.desde); params.set('hasta', f.hasta); }

  const res  = await fetch(`${API}/api/dashboard/resumen?${params}`);
  const data = await res.json();
  if (!data.success) return;

  const k = data.kpis;
  document.getElementById('ventasBruto').textContent     = fmt(k.ventas_brutas);
  document.getElementById('ticketPromedio').textContent  = fmt(k.ticket_promedio);
  document.getElementById('volumenProductos').textContent= k.unidades_vendidas;
  document.getElementById('totalITBMS').textContent      = fmt(k.itbms_total);
  document.getElementById('numPedidos').textContent      = k.total_pedidos;
  document.getElementById('ventasNeto').textContent      = fmt(k.ventas_netas);
  document.getElementById('gananciaTotal').textContent   = fmt(k.ganancia_total);
  document.getElementById('margenPromedio').textContent  = k.margen_promedio + '%';

  // Contadores estado
  const estados = data.graficas.estados || [];
  document.getElementById('pedidosPendientes').textContent =
    (estados.find(e=>e.estado==='Pendiente')?.cantidad || 0);
  document.getElementById('pedidosEntregados').textContent =
    (estados.find(e=>e.estado==='Entregado')?.cantidad  || 0);
  document.getElementById('pedidosCancelados').textContent =
    (estados.find(e=>e.estado==='Cancelado')?.cantidad  || 0);

  renderizarGraficaCategorias(data.graficas.categorias || []);
  renderizarGraficaEstados(estados);
}

// ── ANÁLISIS ──────────────────────────────────────────────
async function cargarAnalisis() {
  const f = filtrosFecha.analisis;
  const params = new URLSearchParams({ filtro: f.tipo });
  if (f.tipo === 'rango') { params.set('desde', f.desde); params.set('hasta', f.hasta); }

  const res  = await fetch(`${API}/api/dashboard/analisis?${params}`);
  const data = await res.json();
  if (!data.success) return;

  renderizarTop5(data.top5_productos   || []);
  renderizarStockCritico(data.stock_alertas || []);
  renderizarCategorias(data.categorias      || []);
}

// ── INVENTARIO ────────────────────────────────────────────
async function cargarProductos(buscar='') {
  const params = buscar ? new URLSearchParams({buscar}) : '';
  const res  = await fetch(`${API}/api/dashboard/productos${params?'?'+params:''}`);
  const data = await res.json();
  if (!data.success) return;
  productosOriginales = data.productos;
  renderizarProductos(data.productos);
  llenarDatalistCategorias(data.productos);
}

function filtrarProductos() {
  const q = document.getElementById('buscarProducto').value.toLowerCase();
  const filtrados = productosOriginales.filter(p =>
    p.nombre.toLowerCase().includes(q) ||
    p.id.toLowerCase().includes(q) ||
    (p.categoria||'').toLowerCase().includes(q)
  );
  renderizarProductos(filtrados);
}

function renderizarProductos(lista) {
  const grid = document.getElementById('gridProductos');
  if (!lista.length) {
    grid.innerHTML = '<div class="empty-state"><i class="fas fa-gem"></i><p>No se encontraron productos</p></div>';
    return;
  }
  grid.innerHTML = lista.map(p => {
    const itbms       = parseFloat(p.itbms_pct) || 0;
    const precio      = parseFloat(p.precio_base);
    const precioFinal = precio + (precio * itbms / 100);
    const costo       = parseFloat(p.costo) || 0;
    const margenPct   = precio > 0 ? Math.round(((precio - costo) / precio) * 100) : 0;
    const margenCls   = margenPct >= 30 ? 'high' : margenPct >= 15 ? 'medium' : 'low';
    const stockCls    = p.stock <= 0 ? 'critical' : p.stock <= 4 ? 'low' : 'ok';
    const stockTxt    = p.stock <= 0 ? '❌ AGOTADO' : p.stock <= 4 ? `🔥 Solo ${p.stock}` : `✓ ${p.stock}`;
    return `
    <div class="product-card">
      <div class="product-card-image">
        <img src="${p.imagen_url||''}" alt="${p.nombre}"
             onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22160%22%3E%3Crect fill=%22%232C2C2C%22 width=%22300%22 height=%22160%22/%3E%3Ctext x=%22150%22 y=%2285%22 fill=%22%23FFD700%22 text-anchor=%22middle%22 font-size=%2240%22%3E💎%3C/text%3E%3C/svg%3E'">
      </div>
      <div class="product-card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span class="product-card-id">${p.id}</span>
          ${p.destacado ? '<span class="product-card-featured">⭐ DESTACADO</span>' : ''}
        </div>
        <div class="product-card-name">${p.nombre}</div>
        <div class="product-card-category">${p.categoria||'Sin categoría'}</div>
        <div class="product-card-info">
          <span class="product-card-price">$${fmtNum(precioFinal)}</span>
          <span class="product-card-stock ${stockCls}">${stockTxt}</span>
        </div>
        <div class="product-card-margin">
          <span class="cost">Costo: $${fmtNum(costo)}</span>
          <span class="margin ${margenCls}">Margen: ${margenPct}%</span>
        </div>
        <div class="product-card-actions">
          <button class="btn btn-sm" onclick="editarProducto('${p.id}')">
            <i class="fas fa-edit"></i> Editar
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── CLIENTES ──────────────────────────────────────────────
async function cargarClientes() {
  const f = filtrosFecha.clientes;
  const params = new URLSearchParams({ filtro: f.tipo });
  if (f.tipo === 'rango') { params.set('desde', f.desde); params.set('hasta', f.hasta); }

  const res  = await fetch(`${API}/api/dashboard/clientes?${params}`);
  const data = await res.json();
  if (!data.success) return;

  renderizarTop5Clientes(data.top5 || []);
  renderizarTablaClientes(data.clientes || []);
}

function renderizarTablaClientes(lista) {
  const tbody = document.getElementById('tablaClientes');
  if (!lista.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-dim)">Sin clientes aún</td></tr>'; return; }
  tbody.innerHTML = lista.map(c => `
    <tr>
      <td><strong style="color:var(--text-bright)">${c.nombre}</strong></td>
      <td style="color:var(--text-dim)">${c.email||'—'}</td>
      <td>${c.telefono||'—'}</td>
      <td style="color:var(--text-dim);max-width:200px;overflow:hidden;text-overflow:ellipsis">${c.direccion||'—'}</td>
      <td><span style="color:var(--primary);font-weight:600">${c.total_pedidos}</span></td>
      <td><span style="color:var(--success);font-family:'Orbitron',sans-serif;font-size:0.9rem">$${fmtNum(c.total_gastado)}</span></td>
    </tr>`).join('');
}

// ── TEMPORAL ──────────────────────────────────────────────
async function cargarTemporal() {
  try {
    // Si la pestaña temporal está comentada, el canvas no existe — salir silenciosamente
    if (!document.getElementById('chartVentasDiarias')) return;

    const f = filtrosFecha.temporal;
    const params = new URLSearchParams({ filtro: f.tipo });
    if (f.tipo === 'rango') { params.set('desde', f.desde); params.set('hasta', f.hasta); }

    const res  = await fetch(`${API}/api/dashboard/temporal?${params}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success) return;
    renderizarTemporal(data.dias || []);
  } catch(e) {
    console.warn('Temporal no disponible:', e.message);
  }
}

// ── PEDIDOS ───────────────────────────────────────────────
async function cargarPedidos(estado='todos', buscar='', desde='', hasta='') {
  const params = new URLSearchParams({ estado });
  if (buscar) params.set('buscar', buscar);
  if (desde)  params.set('desde', desde);
  if (hasta)  params.set('hasta', hasta);

  const res  = await fetch(`${API}/api/dashboard/pedidos?${params}`);
  const data = await res.json();
  if (!data.success) return;
  pedidosOriginales = data.pedidos;
  renderizarPedidos(data.pedidos);
}

function filtrarPedidosPorEstado(estado) {
  filtroEstadoActual = estado;
  ['filtroTodos','filtroPendiente','filtroEntregado','filtroCancelado']
    .forEach(id => document.getElementById(id)?.classList.remove('active'));
  const mapa = { todos:'filtroTodos', Pendiente:'filtroPendiente', Entregado:'filtroEntregado', Cancelado:'filtroCancelado' };
  document.getElementById(mapa[estado])?.classList.add('active');
  cargarPedidos(estado);
}

function buscarPedidos() {
  const id     = document.getElementById('buscadorPedidoId').value.trim();
  const client = document.getElementById('buscadorPedidoCliente').value.trim();
  const desde  = document.getElementById('buscadorFechaInicio').value;
  const hasta  = document.getElementById('buscadorFechaFin').value;
  const buscar = id || client;
  cargarPedidos(filtroEstadoActual, buscar, desde, hasta);
}

function limpiarBuscadorPedidos() {
  ['buscadorPedidoId','buscadorPedidoCliente','buscadorFechaInicio','buscadorFechaFin']
    .forEach(id => { document.getElementById(id).value=''; });
  cargarPedidos(filtroEstadoActual);
}


// ── RENDERIZAR PEDIDOS ── ★ ACTUALIZADO con Aprobar/Cancelar
function renderizarPedidos(lista) {
  const tbody = document.getElementById('tablaPedidos');
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-dim);padding:40px">Sin pedidos</td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(p => {
    // Usar estado_pago para la lógica de botones
    const estadoPago   = (p.estado_pago || '').toLowerCase();
    const esPendiente  = estadoPago === 'pendiente';
    const esAprobado   = estadoPago === 'aprobado';
    const esCancelado  = estadoPago === 'cancelado' || p.estado === 'Cancelado';

    // Badge visual: mostrar estado_pago si existe, sino estado
    const badgeTexto = esAprobado ? 'Aprobado' : esCancelado ? 'Cancelado' : (p.estado || 'Pendiente');
    const badgeCls   = esAprobado ? 'aprobado' : esCancelado ? 'cancelado' : 'pendiente';

    const linkCliente = p.token_vista
      ? `<a href="/pedido?id=${p.id_pedido}&key=${p.token_vista}" target="_blank" title="Ver ficha del cliente"
           style="color:var(--primary);text-decoration:none;margin-left:6px;font-size:11px;">
           <i class="fas fa-external-link-alt"></i></a>`
      : '';

    let acciones = '';
    if (esPendiente) {
      acciones = `
        <div style="display:flex;flex-direction:column;gap:4px;">
          <button class="btn btn-sm btn-success" onclick="aprobarPedido('${p.id_pedido}')"
            style="font-size:11px;padding:4px 8px;white-space:nowrap;">
            <i class="fas fa-check"></i> Aprobar
          </button>
          <button class="btn btn-sm btn-danger" onclick="cancelarPedidoPanel('${p.id_pedido}')"
            style="font-size:11px;padding:4px 8px;white-space:nowrap;">
            <i class="fas fa-times"></i> Cancelar
          </button>
          <button class="btn btn-sm" onclick="reenviarSeguimiento('${p.id_pedido}','${p.cliente_nombre}','${p.cliente_tel||''}','${p.token_vista||''}')"
            style="font-size:11px;padding:4px 8px;white-space:nowrap;background:rgba(37,211,102,.15);
                   color:#25D366;border:1px solid rgba(37,211,102,.3);">
            <i class="fab fa-whatsapp"></i> Reenviar
          </button>
        </div>`;
    } else if (esAprobado) {
      acciones = `
        <div style="display:flex;flex-direction:column;gap:4px;">
          <button class="btn btn-sm" onclick="abrirModalEstado('${p.id_pedido}','${p.estado}')">
            <i class="fas fa-edit"></i> Estado
          </button>
          <button class="btn btn-sm" onclick="reenviarSeguimiento('${p.id_pedido}','${p.cliente_nombre}','${p.cliente_tel||''}','${p.token_vista||''}')"
            style="font-size:11px;padding:4px 8px;white-space:nowrap;background:rgba(37,211,102,.15);
                   color:#25D366;border:1px solid rgba(37,211,102,.3);">
            <i class="fab fa-whatsapp"></i> Reenviar
          </button>
        </div>`;
    }

    return `
    <tr>
      <td>
        <span style="font-family:'Orbitron',sans-serif;font-size:0.8rem;color:var(--primary)">${p.id_pedido}</span>
        ${linkCliente}
      </td>
      <td>${p.fecha}</td>
      <td><strong style="color:var(--text-bright)">${p.cliente_nombre}</strong></td>
      <td style="color:var(--text-dim)">${p.cliente_email||'—'}</td>
      <td><span style="color:var(--success);font-weight:600">$${fmtNum(p.total)}</span></td>
      <td><span class="badge status-${badgeCls}">${badgeTexto}</span></td>
      <td><button class="btn btn-sm btn-icon" onclick="verFactura('${p.id_pedido}')"><i class="fas fa-eye"></i></button></td>
      <td>${acciones}</td>
    </tr>`;
  }).join('');
}

// ── ENTREGAS ──────────────────────────────────────────────
async function cargarEntregas() {
  const res  = await fetch(`${API}/api/dashboard/entregas`);
  const data = await res.json();
  if (!data.success) return;
  renderizarEntregas(data.entregas || []);
}

function renderizarEntregas(lista) {
  const cont = document.getElementById('listaEntregas');
  if (!lista.length) {
    cont.innerHTML = '<div class="empty-state"><i class="fas fa-truck"></i><p>No hay entregas pendientes 🎉</p></div>';
    return;
  }
  cont.innerHTML = lista.map(e => {
    const urgente  = e.urgente;
    const diasCls  = urgente ? 'viejo' : 'normal';
    const diasTxt  = e.dias_pendiente === 0 ? 'Hoy' : `${e.dias_pendiente} día${e.dias_pendiente>1?'s':''}`;
    const detalle  = e.detalle || [];
    return `
    <div class="entrega-card ${urgente?'urgente':''}">
      <div class="entrega-urgencia-banner">
        <i class="fas fa-exclamation-triangle"></i>
        URGENTE — ${e.dias_pendiente} días sin entregar
      </div>
      <div class="entrega-body">
        <div class="entrega-header">
          <div class="entrega-info">
            <h4><i class="fas fa-hashtag" style="color:var(--primary);margin-right:6px;font-size:0.9rem"></i>${e.id_pedido}</h4>
            <p><i class="fas fa-user"></i> ${e.cliente_nombre}</p>
            <p><i class="fas fa-phone"></i> ${e.cliente_tel||'—'}</p>
            <p><i class="fas fa-map-marker-alt"></i> ${e.direccion||'—'}</p>
          </div>
          <div class="entrega-meta">
            <div class="entrega-dias ${diasCls}">${diasTxt}</div>
            <div class="entrega-fecha">${e.fecha}</div>
            <div class="entrega-total">$${fmtNum(e.total)}</div>
          </div>
        </div>
        <div class="entrega-productos">
          <h5><i class="fas fa-box"></i> Productos a entregar</h5>
          ${detalle.map(d=>`
            <div class="producto-item">
              <span class="producto-nombre">${d.nombre_producto}</span>
              <span class="producto-cantidad">x${d.cantidad}</span>
            </div>`).join('')}
        </div>
      </div>
      <div class="entrega-actions">
        <button class="btn btn-success btn-sm" onclick="marcarEntregado('${e.id_pedido}')">
          <i class="fas fa-check"></i> Marcar Entregado
        </button>
        <button class="btn btn-sm" onclick="abrirModalEstado('${e.id_pedido}','Pendiente')">
          <i class="fas fa-edit"></i> Cambiar Estado
        </button>
      </div>
    </div>`;
  }).join('');
}

async function marcarEntregado(idPedido) {
  await cambiarEstadoPedido(idPedido, 'Entregado');
}

// ── HISTÓRICOS ────────────────────────────────────────────
async function cargarHistoricos() {
  const res  = await fetch(`${API}/api/dashboard/historicos`);
  const data = await res.json();
  if (!data.success) return;
  renderizarKPIsAnuales(data.kpis_por_anio || []);
}

async function buscarHistoricos() {
  const buscar = document.getElementById('valorBusquedaHist').value.trim();
  const anio   = document.getElementById('anioBusqueda').value.trim();
  const params = new URLSearchParams();
  if (buscar) params.set('buscar', buscar);
  if (anio)   params.set('anio',   anio);

  const res  = await fetch(`${API}/api/dashboard/historicos?${params}`);
  const data = await res.json();
  if (!data.success) return;

  const cont = document.getElementById('resultadosHistoricos');
  if (!data.pedidos.length) {
    cont.innerHTML = '<div class="empty-state"><i class="fas fa-search"></i><p>No se encontraron pedidos archivados</p></div>';
    return;
  }
  cont.innerHTML = `<div class="table-container"><table>
    <thead><tr><th>ID</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Estado</th></tr></thead>
    <tbody>${data.pedidos.map(p=>`
      <tr>
        <td style="font-family:'Orbitron',sans-serif;font-size:0.8rem;color:var(--primary)">${p.id_pedido}</td>
        <td>${p.fecha}</td>
        <td>${p.cliente_nombre}</td>
        <td style="color:var(--success)">$${fmtNum(p.total)}</td>
        <td><span class="badge status-${(p.estado||'').toLowerCase()}">${p.estado}</span></td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

function limpiarHistoricos() {
  document.getElementById('valorBusquedaHist').value = '';
  document.getElementById('anioBusqueda').value = '';
  document.getElementById('resultadosHistoricos').innerHTML =
    '<div class="empty-state"><i class="fas fa-archive"></i><p>Usa el buscador para encontrar pedidos archivados</p></div>';
}

async function archivarAnioAnterior() {
  if (!confirm(`¿Archivar pedidos del año ${new Date().getFullYear()-1}? Esta acción no elimina datos.`)) return;
  const res  = await fetch(`${API}/api/dashboard/historicos`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ anio: new Date().getFullYear()-1 })
  });
  const data = await res.json();
  if (data.success) mostrarToast(`${data.archivados} pedidos archivados`, 'success');
  else mostrarToast('Error al archivar', 'error');
}

function renderizarKPIsAnuales(lista) {
  const cont = document.getElementById('kpiComparativoCards');
  if (!lista.length) {
    cont.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:20px;">No hay datos históricos aún</p>';
    return;
  }
  cont.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;">
    ${lista.map(a=>`
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon"><i class="fas fa-calendar"></i></div><span class="kpi-label">${a.anio}</span></div>
        <div class="kpi-value">$${fmtNum(a.ventas_brutas)}</div>
        <div class="kpi-subtitle">${a.total_pedidos} pedidos · Margen ${a.margen}%</div>
      </div>`).join('')}
  </div>`;

  // Gráfica ventas anuales
  renderizarGraficaAnual(lista);
}

// ── MODAL ESTADO ──────────────────────────────────────────
function abrirModalEstado(idPedido, estadoActual) {
  pedidoSeleccionado = idPedido;
  document.getElementById('idPedidoModal').textContent = idPedido;
  document.getElementById('nuevoEstado').value = estadoActual;
  document.getElementById('modalEstado').classList.add('active');
}

async function confirmarCambioEstado() {
  const nuevo = document.getElementById('nuevoEstado').value;
  await cambiarEstadoPedido(pedidoSeleccionado, nuevo);
  cerrarModal('modalEstado');
}


// ── APROBAR PEDIDO ── ★ NUEVA ──────────────────────────────
async function aprobarPedido(idPedido) {
  if (!confirm(`¿Confirmar pago recibido del pedido ${idPedido}?\n\nEl estado cambiará a "Aprobado" y el cliente verá su cintillo en VERDE.`)) return;
  try {
    const res  = await fetch(`${API}/api/dashboard/pedidos`, {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ id_pedido: idPedido, accion: 'aprobar' }),
    });
    const data = await res.json();
    if (data.success) {
      mostrarToast(`✅ Pedido ${idPedido} APROBADO`, 'success');
      reproducirCampana();
      cargarPedidos(filtroEstadoActual);
      cargarEntregas();
      cargarOverview();
    } else {
      mostrarToast('Error: ' + data.error, 'error');
    }
  } catch(e) {
    mostrarToast('Error de conexión', 'error');
  }
}

// ── CANCELAR PEDIDO ── ★ NUEVA (devuelve stock automático) ──
async function cancelarPedidoPanel(idPedido) {
  if (!confirm(`¿Cancelar el pedido ${idPedido}?\n\n⚠️ El stock se devolverá automáticamente al inventario en D1.`)) return;
  try {
    const res  = await fetch(`${API}/api/dashboard/pedidos`, {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ id_pedido: idPedido, accion: 'cancelar' }),
    });
    const data = await res.json();
    if (data.success) {
      mostrarToast(`Pedido ${idPedido} cancelado · Stock devuelto ↩️`, 'warning');
      cargarPedidos(filtroEstadoActual);
      cargarProductos();
      cargarOverview();
    } else {
      mostrarToast('Error: ' + data.error, 'error');
    }
  } catch(e) {
    mostrarToast('Error de conexión', 'error');
  }
}

// ── CAMBIAR ESTADO ── ★ ACTUALIZADO ────────────────────────
async function cambiarEstadoPedido(idPedido, nuevoEstado) {
  try {
    const res  = await fetch(`${API}/api/dashboard/pedidos`, {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ id_pedido: idPedido, nuevo_estado: nuevoEstado }),
    });
    const data = await res.json();
    if (data.success) {
      const msg = nuevoEstado === 'Cancelado'
        ? `Pedido ${idPedido} cancelado · Stock devuelto ↩️`
        : `Pedido ${idPedido} → ${nuevoEstado}`;
      mostrarToast(msg, 'success');
      cargarPedidos(filtroEstadoActual);
      cargarEntregas();
      cargarOverview();
      if (nuevoEstado === 'Cancelado') cargarProductos();
    } else {
      mostrarToast('Error: ' + data.error, 'error');
    }
  } catch(e) {
    mostrarToast('Error de conexión', 'error');
  }
}

// ── MODAL PRODUCTO ────────────────────────────────────────
function abrirModalProducto() {
  document.getElementById('modoEdicion').value = 'crear';
  document.getElementById('productoIdEdicion').value = '';
  document.getElementById('tituloModalProducto').innerHTML = '<i class="fas fa-gem"></i> NUEVO PRODUCTO';
  document.getElementById('btnEliminarProducto').style.display = 'none';
  ['productoNombre','productoDescripcion','productoIdInput','productoCategoria',
   'productoPrecio','productoCosto','productoStock','productoImagenURL'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('productoDestacado').checked = false;
  document.getElementById('productoITBMS').value = '7';
  document.getElementById('countNombre').textContent = '0 / 70';
  document.getElementById('countDesc').textContent   = '0 / 100';
  document.getElementById('previsualizacion').style.display = 'none';
  document.getElementById('modalProducto').classList.add('active');
  cargarContadorFotos();
}

function editarProducto(id) {
  const p = productosOriginales.find(x => x.id === id);
  if (!p) return;
  document.getElementById('modoEdicion').value = 'editar';
  document.getElementById('productoIdEdicion').value = p.id;
  document.getElementById('tituloModalProducto').innerHTML = '<i class="fas fa-edit"></i> EDITAR PRODUCTO';
  document.getElementById('btnEliminarProducto').style.display = 'inline-flex';
  document.getElementById('productoNombre').value      = p.nombre      || '';
  document.getElementById('productoDescripcion').value = p.descripcion || '';
  document.getElementById('productoIdInput').value     = p.id;
  document.getElementById('productoCategoria').value   = p.categoria   || '';
  document.getElementById('productoPrecio').value      = p.precio_base || '';
  document.getElementById('productoCosto').value       = p.costo       || '';
  document.getElementById('productoStock').value       = p.stock       || '';
  document.getElementById('productoITBMS').value       = p.itbms_pct   || '7';
  document.getElementById('productoImagenURL').value   = p.imagen_url  || '';
  document.getElementById('productoDestacado').checked = p.destacado == 1;
  validarSemaforo(document.getElementById('productoNombre'),'countNombre',70,45,60);
  validarSemaforo(document.getElementById('productoDescripcion'),'countDesc',100,75,90);
  if (p.imagen_url) {
    document.getElementById('imgPreview').src = p.imagen_url;
    document.getElementById('previsualizacion').style.display = 'block';
  }
  document.getElementById('modalProducto').classList.add('active');
  cargarContadorFotos();
}

async function guardarProducto() {
  const modo = document.getElementById('modoEdicion').value;
  const payload = {
    id:          document.getElementById('productoIdInput').value.trim() ||
                 document.getElementById('productoIdEdicion').value.trim(),
    nombre:      document.getElementById('productoNombre').value.trim(),
    descripcion: document.getElementById('productoDescripcion').value.trim(),
    categoria:   document.getElementById('productoCategoria').value.trim(),
    precio_base: document.getElementById('productoPrecio').value,
    costo:       document.getElementById('productoCosto').value,
    stock:       document.getElementById('productoStock').value,
    itbms_pct:   document.getElementById('productoITBMS').value,
    imagen_url:  document.getElementById('productoImagenURL').value.trim(),
    destacado:   document.getElementById('productoDestacado').checked,
  };

  if (!payload.nombre || !payload.precio_base) {
    mostrarToast('Nombre y precio son requeridos', 'error'); return;
  }

  try {
    const method = modo === 'crear' ? 'POST' : 'PUT';
    const res    = await fetch(`${API}/api/dashboard/productos`, {
      method, headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) {
      mostrarToast(modo === 'crear' ? 'Producto creado ✅' : 'Producto actualizado ✅', 'success');
      cerrarModal('modalProducto');
      cargarProductos();
    } else {
      mostrarToast('Error: ' + data.error, 'error');
    }
  } catch(e) {
    mostrarToast('Error de conexión', 'error');
  }
}

async function eliminarProductoConfirm() {
  const id = document.getElementById('productoIdEdicion').value;
  if (!confirm(`¿Eliminar producto ${id}? El historial de pedidos se conserva.`)) return;
  const res  = await fetch(`${API}/api/dashboard/productos`, {
    method:'DELETE', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ id }),
  });
  const data = await res.json();
  if (data.success) {
    mostrarToast('Producto eliminado', 'success');
    cerrarModal('modalProducto');
    cargarProductos();
  } else {
    mostrarToast('Error: ' + data.error, 'error');
  }
}

// ── FACTURA ───────────────────────────────────────────────
function verFactura(idPedido) {
  const pedido = pedidosOriginales.find(p => p.id_pedido === idPedido);
  if (!pedido) return;
  const detalle = pedido.detalle || [];
  document.getElementById('facturaContenido').innerHTML = `
    <div style="border-bottom:1px solid var(--border);padding-bottom:16px;margin-bottom:16px;">
      <p style="color:var(--primary);font-family:'Orbitron',sans-serif;font-size:1.1rem;margin-bottom:8px">${pedido.id_pedido}</p>
      <p style="color:var(--text-dim)">Fecha: ${pedido.fecha}</p>
      <p><strong>Cliente:</strong> ${pedido.cliente_nombre}</p>
      <p style="color:var(--text-dim)">${pedido.cliente_email||''} · ${pedido.cliente_tel||''}</p>
      <p style="color:var(--text-dim)">${pedido.direccion||''}</p>
    </div>
    <table>
      <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>ITBMS</th><th>Subtotal</th></tr></thead>
      <tbody>
        ${detalle.map(d=>`
          <tr>
            <td>${d.nombre_producto}</td>
            <td style="text-align:center">${d.cantidad}</td>
            <td>$${fmtNum(d.precio_base)}</td>
            <td>${d.itbms_pct}%</td>
            <td style="color:var(--success)">$${fmtNum(d.subtotal)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);text-align:right;">
      <p style="color:var(--text-dim)">Subtotal: $${fmtNum(pedido.subtotal)}</p>
      <p style="color:var(--text-dim)">ITBMS: $${fmtNum(pedido.itbms_total)}</p>
      <p style="font-family:'Orbitron',sans-serif;font-size:1.2rem;color:var(--primary);margin-top:8px">
        TOTAL: $${fmtNum(pedido.total)}
      </p>
      <p style="margin-top:8px"><span class="badge status-${(pedido.estado||'').toLowerCase()}">${pedido.estado}</span></p>
    </div>`;
  document.getElementById('modalFactura').classList.add('active');
}

// ── EXPORTAR ──────────────────────────────────────────────
function exportarProductosExcel() {
  const cols = ['ID','Nombre','Descripción','Precio Base','Costo','Categoría','Stock','ITBMS%','Destacado'];
  const rows = productosOriginales.map(p => [
    p.id, p.nombre, p.descripcion || '', p.precio_base, p.costo || 0,
    p.categoria, p.stock, p.itbms_pct, p.destacado ? 'Sí' : 'No'
  ]);
  descargarExcel(cols, rows, 'productos_elegance');
}

// ── Plantilla vacía para importación masiva ── ★ NUEVO
function descargarPlantillaProductos() {
  const cols = ['Nombre','Descripción','Precio Base','Costo','Categoría','Stock','ITBMS%','Destacado'];
  const ejemplo = [
    ['Anillo Solitario Oro 18K','Anillo clásico en oro amarillo 18K','850','520','Anillos','10','7','Sí'],
    ['Aretes Argolla Plata','Argollas en plata 925 diámetro 3cm','95','45','Aretes','20','7','No'],
    ['Collar Perlas','Collar de perlas cultivadas largo 45cm','320','180','Collares','5','7','Sí'],
  ];
  // Nota explicativa como primera fila
  const nota = [['⚠️ INSTRUCCIONES: No modifiques los encabezados. Columna "Destacado": escribe Sí o No. ITBMS% normalmente es 7. Deja "ID" vacío para que se genere automático.','','','','','','','']];
  descargarExcel(
    ['📋 PLANTILLA — Completar y luego importar con el botón Importar', '', '', '', '', '', '', ''],
    [...nota, cols, ...ejemplo],
    'plantilla_productos_elegance'
  );
  mostrarToast('Plantilla descargada. Llénala y usa el botón Importar ✅', 'success');
}

// ── Importación masiva desde Excel/CSV ── ★ NUEVO
async function importarProductosDesdeExcel(input) {
  const archivo = input.files[0];
  if (!archivo) return;
  input.value = '';

  // ── ERROR 5: Formato de archivo ─────────────────────────
  const ext = archivo.name.split('.').pop().toLowerCase();
  if (!['xlsx', 'xls', 'csv'].includes(ext)) {
    mostrarToast('Formato no válido. Solo se aceptan archivos .xlsx, .xls o .csv', 'error');
    return;
  }

  // ── Leer archivo con SheetJS ─────────────────────────────
  const buffer = await archivo.arrayBuffer();
  let filas = [];
  try {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const hoja     = workbook.Sheets[workbook.SheetNames[0]];
    filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' });
  } catch(e) {
    mostrarToast('No se pudo leer el archivo. Asegúrate de que no esté dañado.', 'error');
    return;
  }

  // ── ERROR 6: Filas vacías — limpiar antes de procesar ────
  filas = filas.filter(f => f.some(c => String(c).trim() !== ''));

  // ── ERROR 2: Encabezados alterados ──────────────────────
  // Buscar fila que tenga exactamente "nombre" como celda
  let headerIdx = filas.findIndex(f =>
    f.some(c => String(c).toLowerCase().trim() === 'nombre')
  );
  if (headerIdx === -1) {
    mostrarToast(
      '❌ No se encontró la columna "Nombre". ' +
      'Asegúrate de no haber cambiado los encabezados de la plantilla.',
      'error'
    );
    return;
  }

  const headers    = filas[headerIdx].map(h => String(h).toLowerCase().trim());
  const col        = keyword => headers.findIndex(h => h.includes(keyword));
  const iNombre    = col('nombre');
  const iDesc      = col('descrip');
  const iPrecio    = col('precio');
  const iCosto     = col('costo');
  const iCat       = col('categ');
  const iStock     = col('stock');
  const iItbms     = col('itbms');
  const iDestacado = col('destac');

  // Verificar columnas obligatorias
  const faltantes = [];
  if (iNombre === -1) faltantes.push('"Nombre"');
  if (iPrecio === -1) faltantes.push('"Precio Base"');
  if (faltantes.length > 0) {
    mostrarToast(`❌ Columnas obligatorias no encontradas: ${faltantes.join(' y ')}`, 'error');
    return;
  }

  // ── Categorías existentes para validación ────────────────
  const categoriasExistentes = [...new Set(
    productosOriginales.map(p => (p.categoria || '').toLowerCase().trim()).filter(Boolean)
  )];

  // ── Función limpiadora de números (Error 1) ──────────────
  function limpiarNumero(raw, defecto = 0) {
    if (raw === null || raw === undefined || raw === '') return defecto;
    // Quitar símbolos: $, B/., espacios, letras
    const limpio = String(raw)
      .replace(/[B\/\.\$\s]/g, '')   // quita B/, $, espacios
      .replace(/[^\d,\.\-]/g, '')    // quita todo excepto dígitos, coma, punto, guión
      .replace(/,(\d{2})$/, '.$1')   // convierte coma decimal: 150,00 → 150.00
      .replace(/,/g, '');            // quita separadores de miles restantes
    const num = parseFloat(limpio);
    return isNaN(num) ? defecto : num;
  }

  // ── Función sanitizadora de texto (Error 3) ──────────────
  function sanitizar(raw, maxLen = 200) {
    return String(raw || '')
      .replace(/[\u201C\u201D\u2018\u2019]/g, '"')  // comillas inteligentes → normales
      .replace(/[\r\n\t]/g, ' ')                     // saltos de línea → espacio
      .replace(/[^\x20-\x7E\u00C0-\u024F]/g, '')    // eliminar caracteres raros (mantiene español)
      .trim()
      .slice(0, maxLen);
  }

  // ── Pre-validación completa (muestra errores por fila) ───
  const filasDatos = filas.slice(headerIdx + 1);
  const erroresPrevios = [];
  const productosProcesar = [];

  filasDatos.forEach((f, idx) => {
    const numFila   = headerIdx + idx + 2; // número real en Excel (1-indexed + encabezados)
    const nombre    = sanitizar(f[iNombre]);
    const precioRaw = f[iPrecio] ?? '';
    const precio    = limpiarNumero(precioRaw);

    // ── ERROR 6: Fila vacía — ignorar silenciosamente
    if (!nombre && !precioRaw) return;

    // ── Ignorar filas de pie de página e instrucciones
    const esFilaSistema = nombre.toLowerCase().includes('elegance jewelry') ||
                          nombre.toLowerCase().includes('generado el') ||
                          nombre.startsWith('⚠') || nombre.startsWith('📋') ||
                          nombre.toLowerCase().includes('instruc') ||
                          nombre.toLowerCase().includes('plantilla');
    if (esFilaSistema) return;

    // ── ERROR 7: Nombre obligatorio
    if (!nombre) {
      erroresPrevios.push(`Fila ${numFila}: falta el Nombre.`);
      return;
    }

    // ── ERROR 1: Precio inválido
    if (!precio || precio <= 0) {
      erroresPrevios.push(
        `Fila ${numFila} (${nombre}): precio "${precioRaw}" no es un número válido.`
      );
      return;
    }

    // ── ERROR 4: Categoría inconsistente — normalizar a Title Case
    let categoria = sanitizar(f[iCat] ?? '');
    if (categoria) {
      // Normalizar: primera letra mayúscula, resto minúsculas
      categoria = categoria.charAt(0).toUpperCase() + categoria.slice(1).toLowerCase();
      // Advertencia si no coincide con ninguna existente (no bloquea, solo avisa)
      if (categoriasExistentes.length > 0 &&
          !categoriasExistentes.includes(categoria.toLowerCase())) {
        erroresPrevios.push(
          `Fila ${numFila} (${nombre}): categoría "${categoria}" es nueva y se creará.`
        );
      }
    }

    const destacadoRaw = String(iDestacado >= 0 ? f[iDestacado] ?? '' : '');
    productosProcesar.push({
      _fila:       numFila,
      nombre,
      descripcion: sanitizar(f[iDesc] ?? '', 100),
      precio_base: precio,
      costo:       limpiarNumero(f[iCosto] ?? ''),
      categoria,
      stock:       Math.max(0, parseInt(f[iStock] ?? '0') || 0),
      itbms_pct:   limpiarNumero(f[iItbms] ?? '', 7) || 7,
      destacado:   /^s[íi]$/i.test(destacadoRaw.trim()) || destacadoRaw.trim() === '1',
    });
  });

  // Si hay errores bloqueantes, mostrarlos antes de proceder
  const bloqueantes = erroresPrevios.filter(e => !e.includes('es nueva'));
  if (bloqueantes.length > 0) {
    const lista = bloqueantes.slice(0, 5).join('\n');
    const extra = bloqueantes.length > 5 ? `\n...y ${bloqueantes.length - 5} más.` : '';
    alert('⚠️ Errores encontrados en el archivo:\n\n' + lista + extra +
          '\n\nCorrige el archivo y vuelve a importar.');
    return;
  }

  if (productosProcesar.length === 0) {
    mostrarToast('El archivo no tiene productos válidos para importar.', 'error');
    return;
  }

  // Mostrar advertencias de categorías nuevas (no bloqueante)
  const advertencias = erroresPrevios.filter(e => e.includes('es nueva'));
  if (advertencias.length > 0) {
    mostrarToast(`ℹ️ ${advertencias.length} categoría(s) nueva(s) serán creadas`, 'info');
    await new Promise(r => setTimeout(r, 1500));
  }

  // ── Modal de progreso ────────────────────────────────────
  const modal    = document.getElementById('modalImportar');
  const msg      = document.getElementById('modalImportarMsg');
  const barra    = document.getElementById('modalImportarBarra');
  const contador = document.getElementById('modalImportarContador');
  modal.style.display = 'flex';

  let ok = 0, errores = 0;
  const erroresDetalle   = [];
  const productosCreados = [];

  for (let i = 0; i < productosProcesar.length; i++) {
    const p = productosProcesar[i];
    const { _fila, ...producto } = p;

    msg.textContent      = `Creando: ${producto.nombre}`;
    barra.style.width    = `${Math.round(((i + 1) / productosProcesar.length) * 100)}%`;
    contador.textContent = `${i + 1} / ${productosProcesar.length} productos`;

    try {
      const res  = await fetch(`${API}/api/dashboard/productos`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(producto),
      });
      const data = await res.json();
      if (data.success) {
        ok++;
        productosCreados.push({ nombre: producto.nombre, id: data.id });
      } else {
        errores++;
        erroresDetalle.push(`Fila ${_fila} (${producto.nombre}): ${data.error || 'error del servidor'}`);
      }
    } catch(e) {
      errores++;
      erroresDetalle.push(`Fila ${_fila} (${producto.nombre}): sin conexión`);
    }

    await new Promise(r => setTimeout(r, 120));
  }

  modal.style.display = 'none';
  await cargarProductos();

  // Reporte final
  if (errores === 0) {
    mostrarToast(`✅ ${ok} productos importados correctamente`, 'success');
  } else {
    const detalle = erroresDetalle.slice(0, 3).join('\n');
    const extra   = erroresDetalle.length > 3 ? `\n...y ${erroresDetalle.length - 3} más.` : '';
    alert(`Importación completada:\n✅ ${ok} creados · ⚠️ ${errores} con error\n\n${detalle}${extra}`);
  }

  if (productosCreados.length > 0) mostrarModalIDs(productosCreados);
}

function exportarClientesExcel() {
  fetch(`${API}/api/dashboard/clientes`).then(r => r.json()).then(data => {
    if (!data.success) return;
    const cols = ['Nombre','Correo','Teléfono','Dirección','Pedidos','Total Gastado'];
    const rows = data.clientes.map(c => [
      c.nombre, c.email, c.telefono || '', c.direccion || '',
      c.total_pedidos, c.total_gastado
    ]);
    descargarExcel(cols, rows, 'clientes_elegance');
  });
}

function exportarPedidosFiltrados() {
  const cols = ['ID Pedido','Fecha','Cliente','Correo','Teléfono','Total','Estado','Estado Pago'];
  const rows = pedidosOriginales.map(p => [
    p.id_pedido, p.fecha, p.cliente_nombre,
    p.cliente_email || '', p.cliente_tel || '',
    p.total, p.estado, p.estado_pago || ''
  ]);
  descargarExcel(cols, rows, `pedidos_elegance_${new Date().toISOString().split('T')[0]}`);
  mostrarToast('Reporte descargado ✅', 'success');
}

// ── Generador de Excel real (.xls) sin librerías externas ──
function descargarExcel(columnas, filas, nombreArchivo) {
  // Estilo dorado Elegance para el encabezado
  const estiloHeader = 'background:#1C1A16;color:#D4AF37;font-weight:bold;font-size:12pt;' +
                       'border:1px solid #8B6914;padding:6px 10px;text-align:center;';
  const estiloFila   = 'border:1px solid #ddd;padding:5px 8px;font-size:11pt;';
  const estiloFilaAlt= 'border:1px solid #ddd;padding:5px 8px;font-size:11pt;background:#FAF8F3;';

  const headerHTML = columnas
    .map(c => `<th style="${estiloHeader}">${c}</th>`)
    .join('');

  const filasHTML = filas.map((fila, i) => {
    const estilo = i % 2 === 0 ? estiloFila : estiloFilaAlt;
    const celdas = fila.map(v => `<td style="${estilo}">${v ?? ''}</td>`).join('');
    return `<tr>${celdas}</tr>`;
  }).join('');

  const fecha = new Date().toLocaleDateString('es-PA');
  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:x="urn:schemas-microsoft-com:office:excel"
          xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="UTF-8">
      <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
        <x:ExcelWorksheet><x:Name>Elegance</x:Name>
        <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
        </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
    </head>
    <body>
      <table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;">
        <thead><tr>${headerHTML}</tr></thead>
        <tbody>${filasHTML}</tbody>
      </table>
      <p style="font-size:9pt;color:#888;margin-top:8px;">
        Elegance Jewelry · Generado el ${fecha}
      </p>
    </body></html>`;

  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = nombreArchivo + '.xls';
  a.click();
  URL.revokeObjectURL(url);
}

// ── GRÁFICAS ──────────────────────────────────────────────
function renderizarGraficaCategorias(datos) {
  const ctx = document.getElementById('chartCategorias');
  if (!ctx) return;
  if (charts.categorias) charts.categorias.destroy();
  if (!datos.length) return;
  charts.categorias = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels:   datos.map(d=>d.categoria||'Sin categoría'),
      datasets: [{ data: datos.map(d=>d.total), backgroundColor: ['#FFD700','#FFC72C','#FFA500','#FF8C00','#FFB347'] }]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ labels:{ color:'#E0E0E0', font:{family:'Rajdhani'} } } } }
  });
}

function renderizarGraficaEstados(datos) {
  const ctx = document.getElementById('chartEstados');
  if (!ctx) return;
  if (charts.estados) charts.estados.destroy();
  if (!datos.length) return;
  const colores = { Pendiente:'#FFB800', Entregado:'#32CD32', Cancelado:'#FF4500' };
  charts.estados = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels:   datos.map(d=>d.estado),
      datasets: [{ data: datos.map(d=>d.cantidad), backgroundColor: datos.map(d=>colores[d.estado]||'#888') }]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ labels:{ color:'#E0E0E0', font:{family:'Rajdhani'} } } } }
  });
}

function renderizarTop5(datos) {
  const ctx = document.getElementById('chartTopProductos');
  if (!ctx) return;
  if (charts.top5) charts.top5.destroy();
  if (!datos.length) return;
  charts.top5 = new Chart(ctx, {
    type: 'bar',
    data: {
      labels:   datos.map(d=>d.nombre_producto),
      datasets: [{ label:'Unidades', data: datos.map(d=>d.unidades), backgroundColor:'rgba(255,215,0,0.6)', borderColor:'#FFD700', borderWidth:1 }]
    },
    options: {
      indexAxis:'y', responsive:true, maintainAspectRatio:false,
      scales: {
        x:{ ticks:{ color:'#A0A0A0' }, grid:{ color:'rgba(255,215,0,0.1)' } },
        y:{ ticks:{ color:'#E0E0E0', font:{family:'Rajdhani'} } }
      },
      plugins:{ legend:{ display:false } }
    }
  });
}

function renderizarTemporal(dias) {
  ['chartVentasDiarias','chartGanancias','chartMargen'].forEach(id => {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (charts[id]) charts[id].destroy();
  });
  if (!dias.length) return;

  const labels = dias.map(d=>d.fecha_iso||d.fecha_display);

  charts['chartVentasDiarias'] = new Chart(document.getElementById('chartVentasDiarias'), {
    data: {
      labels,
      datasets: [
        { type:'bar',  label:'Ventas',  data:dias.map(d=>d.ventas_brutas), backgroundColor:'rgba(255,215,0,0.5)', borderColor:'#FFD700', borderWidth:1 },
        { type:'line', label:'Pedidos', data:dias.map(d=>d.total_pedidos), borderColor:'#32CD32', tension:0.3, yAxisID:'y1' }
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      scales: {
        y:  { ticks:{color:'#A0A0A0'}, grid:{color:'rgba(255,215,0,0.1)'} },
        y1: { position:'right', ticks:{color:'#32CD32'}, grid:{display:false} }
      },
      plugins:{ legend:{ labels:{color:'#E0E0E0',font:{family:'Rajdhani'}} } }
    }
  });

  charts['chartGanancias'] = new Chart(document.getElementById('chartGanancias'), {
    type:'bar',
    data:{ labels, datasets:[{ label:'Ganancia', data:dias.map(d=>d.ganancia), backgroundColor:'rgba(50,205,50,0.5)', borderColor:'#32CD32', borderWidth:1 }] },
    options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{ticks:{color:'#A0A0A0'}, grid:{color:'rgba(50,205,50,0.1)'}}, x:{ticks:{color:'#A0A0A0'}} }, plugins:{legend:{labels:{color:'#E0E0E0'}}} }
  });

  charts['chartMargen'] = new Chart(document.getElementById('chartMargen'), {
    type:'line',
    data:{ labels, datasets:[{ label:'Margen %', data:dias.map(d=>d.margen), borderColor:'#FFD700', backgroundColor:'rgba(255,215,0,0.1)', fill:true, tension:0.3 }] },
    options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{ticks:{color:'#A0A0A0',callback:v=>v+'%'}, grid:{color:'rgba(255,215,0,0.1)'}}, x:{ticks:{color:'#A0A0A0'}} }, plugins:{legend:{labels:{color:'#E0E0E0'}}} }
  });
}

function renderizarTop5Clientes(datos) {
  const ctx = document.getElementById('chartClientesVIP');
  if (!ctx) return;
  if (charts.vip) charts.vip.destroy();
  if (!datos.length) return;
  charts.vip = new Chart(ctx, {
    type:'bar',
    data:{
      labels: datos.map(d=>d.nombre),
      datasets:[{ label:'Total gastado', data:datos.map(d=>d.total_gastado), backgroundColor:'rgba(255,215,0,0.6)', borderColor:'#FFD700', borderWidth:1 }]
    },
    options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{ticks:{color:'#A0A0A0'}, grid:{color:'rgba(255,215,0,0.1)'}}, x:{ticks:{color:'#E0E0E0',font:{family:'Rajdhani'}}} }, plugins:{legend:{display:false}} }
  });
}

function renderizarStockCritico(lista) {
  const tbody = document.getElementById('tablaStockCritico');
  if (!lista.length) { tbody.innerHTML='<tr><td colspan="4" style="text-align:center;color:var(--success);padding:20px">✓ Todo el inventario está en niveles normales</td></tr>'; return; }
  tbody.innerHTML = lista.map(p=>`
    <tr>
      <td><strong style="color:var(--text-bright)">${p.nombre}</strong></td>
      <td>${p.categoria||'—'}</td>
      <td style="font-family:'Orbitron',sans-serif;color:${p.stock<=0?'var(--danger)':'var(--warning)'}">${p.stock}</td>
      <td><span class="badge ${p.nivel==='CRITICO'?'badge-critical':'badge-low'}">${p.nivel}</span></td>
    </tr>`).join('');
}

function renderizarCategorias(lista) {
  const tbody = document.getElementById('tablaVentasCategorias');
  if (!lista.length) { tbody.innerHTML='<tr><td colspan="4" style="text-align:center;color:var(--text-dim);padding:20px">Sin datos de ventas</td></tr>'; return; }
  tbody.innerHTML = lista.map(c=>`
    <tr>
      <td><strong style="color:var(--text-bright)">${c.categoria}</strong></td>
      <td>${c.unidades}</td>
      <td style="color:var(--success)">$${fmtNum(c.ingresos)}</td>
      <td><span style="color:var(--primary);font-weight:600">${c.porcentaje}%</span></td>
    </tr>`).join('');
}

function renderizarGraficaAnual(lista) {
  const ctxV = document.getElementById('chartVentasAnuales');
  const ctxM = document.getElementById('chartMargenTicket');
  if (ctxV) {
    if (charts.anuales) charts.anuales.destroy();
    charts.anuales = new Chart(ctxV, {
      type:'bar',
      data:{ labels:lista.map(a=>a.anio), datasets:[{ label:'Ventas Brutas', data:lista.map(a=>a.ventas_brutas), backgroundColor:'rgba(255,215,0,0.6)', borderColor:'#FFD700', borderWidth:1 }] },
      options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{ticks:{color:'#A0A0A0'}, grid:{color:'rgba(255,215,0,0.1)'}}, x:{ticks:{color:'#E0E0E0'}} }, plugins:{legend:{labels:{color:'#E0E0E0'}}} }
    });
  }
  if (ctxM) {
    if (charts.margenTicket) charts.margenTicket.destroy();
    charts.margenTicket = new Chart(ctxM, {
      data:{
        labels:lista.map(a=>a.anio),
        datasets:[
          { type:'line', label:'Margen %', data:lista.map(a=>a.margen), borderColor:'#FFD700', tension:0.3, yAxisID:'y' },
          { type:'bar',  label:'Ticket $',  data:lista.map(a=>a.ticket_promedio), backgroundColor:'rgba(50,205,50,0.4)', borderColor:'#32CD32', yAxisID:'y1' }
        ]
      },
      options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{ticks:{color:'#A0A0A0',callback:v=>v+'%'}}, y1:{position:'right',ticks:{color:'#32CD32'}} }, plugins:{legend:{labels:{color:'#E0E0E0'}}} }
    });
  }
}

// ── FILTROS ───────────────────────────────────────────────
function aplicarFiltroFecha(tipo, seccion, btn) {
  btn.parentElement.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  const rangoId = `rangoFechas${seccion.charAt(0).toUpperCase()+seccion.slice(1)}`;
  document.getElementById(rangoId)?.classList.remove('show');

  // Calcular fechas en el CLIENTE (hora de Panamá) y mandar como rango a la API
  const hoy   = new Date();
  const pad   = n => String(n).padStart(2,'0');
  const fmt   = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const hoyStr = fmt(hoy);

  let desde = '', hasta = hoyStr;

  if (tipo === 'hoy') {
    desde = hoyStr;
  } else if (tipo === 'semana') {
    const ini = new Date(hoy);
    ini.setDate(hoy.getDate() - hoy.getDay()); // domingo inicio de semana
    desde = fmt(ini);
  } else if (tipo === 'mes') {
    desde = fmt(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  } else if (tipo === 'anio') {
    desde = fmt(new Date(hoy.getFullYear(), 0, 1));
  } else if (tipo === '7dias') {
    const ini = new Date(hoy); ini.setDate(hoy.getDate() - 6);
    desde = fmt(ini);
  } else {
    // 'todo' — sin fechas, la API devuelve todo
    filtrosFecha[seccion] = { tipo:'todo', desde:'', hasta:'' };
    recargarSeccion(seccion);
    return;
  }

  filtrosFecha[seccion] = { tipo:'rango', desde, hasta };
  recargarSeccion(seccion);
}

function toggleRangoFechas(seccion) {
  const rangoId = `rangoFechas${seccion.charAt(0).toUpperCase()+seccion.slice(1)}`;
  document.getElementById(rangoId)?.classList.toggle('show');
}

function aplicarRangoFechas(seccion) {
  const cap   = seccion.charAt(0).toUpperCase()+seccion.slice(1);
  const desde = document.getElementById('fechaInicio'+cap)?.value;
  const hasta = document.getElementById('fechaFin'+cap)?.value;
  if (!desde || !hasta) { mostrarToast('Seleccione ambas fechas','error'); return; }
  if (desde > hasta)    { mostrarToast('Fecha inicial debe ser anterior','error'); return; }
  if (seccion === 'temporal') {
    const dias = Math.round((new Date(hasta)-new Date(desde)) / 86400000);
    if (dias > 30) { mostrarToast('Máximo 30 días en Temporal','error'); return; }
  }
  filtrosFecha[seccion] = { tipo:'rango', desde, hasta };
  recargarSeccion(seccion);
  mostrarToast('Filtro aplicado', 'success');
}

function recargarSeccion(seccion) {
  switch(seccion) {
    case 'overview': cargarOverview(); break;
    case 'analisis': cargarAnalisis(); break;
    case 'clientes': cargarClientes(); break;
    case 'temporal': cargarTemporal(); break;
  }
}

// ── NAVEGACIÓN ────────────────────────────────────────────
function cambiarTab(t) {
  document.querySelectorAll('.nav-tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(x=>x.classList.remove('active'));
  document.querySelector(`[data-tab="${t}"]`).classList.add('active');
  document.getElementById(`tab-${t}`).classList.add('active');
  if (t === 'historicos') cargarHistoricos();
}

// ── SEMÁFORO DE CARACTERES ────────────────────────────────
function validarSemaforo(input, countId, max, amarillo, rojo) {
  const len   = input.value.length;
  const small = document.getElementById(countId);
  small.textContent = `${len} / ${max}`;
  if (len >= rojo)     { small.style.color='#FF4500'; }
  else if (len >= amarillo) { small.style.color='#FFB800'; }
  else                 { small.style.color='#32CD32'; }
}

function previsualizarURLImagen() {
  const url = document.getElementById('productoImagenURL').value.trim();
  if (!url) return;
  document.getElementById('imgPreview').src = url;
  document.getElementById('previsualizacion').style.display = 'block';
}

function llenarDatalistCategorias(productos) {
  const cats = [...new Set(productos.map(p=>p.categoria).filter(Boolean))];
  document.getElementById('listaCategorias').innerHTML = cats.map(c=>`<option value="${c}">`).join('');
}

// ── UTILIDADES ────────────────────────────────────────────
function cerrarModal(id) { document.getElementById(id).classList.remove('active'); }

function mostrarCargando(activo) {
  const b = document.querySelector('.header .btn-primary');
  if (!b) return;
  if (activo) { b.innerHTML='<i class="fas fa-spinner fa-spin"></i> Actualizando...'; b.disabled=true; }
  else        { b.innerHTML='<i class="fas fa-sync-alt"></i> Actualizar'; b.disabled=false; }
}

function mostrarToast(msg, tipo='success') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${tipo}`;
  const icon = tipo==='success'?'fa-check-circle':tipo==='error'?'fa-exclamation-circle':'fa-info-circle';
  t.innerHTML = `<i class="fas ${icon}"></i><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(()=>{ t.style.animation='toastIn 0.3s ease reverse'; setTimeout(()=>t.remove(),300); }, 3000);
}

function fmt(v)    { return '$'+(parseFloat(v)||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,','); }
function fmtNum(v) { return (parseFloat(v)||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,','); }

function reproducirCampana() {
  try {
    const a=document.getElementById('sonidoCampana');
    a.currentTime=0; a.volume=0.7; a.play().catch(()=>{});
  } catch(e){}
}

// Cerrar modales al hacer click fuera
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
  }
});

// ══════════════════════════════════════
// CLOUDINARY — Subida de imágenes
// ══════════════════════════════════════

async function cargarContadorFotos() {
  try {
    const res  = await fetch(`${API}/api/cloudinary?carpeta=minegocio`);
    const data = await res.json();
    if (!data.success) return;

    const total    = data.total  || 0;
    const limite   = data.limite || 200;
    const pct      = Math.round((total / limite) * 100);
    const barColor = pct >= 80 ? 'var(--danger)' : pct >= 60 ? 'var(--warning)' : 'var(--success)';

    const barra = document.getElementById('barraFotos');
    if (barra) barra.style.display = 'block';

    const contador = document.getElementById('contadorFotos');
    if (contador) contador.textContent = `${total}/${limite}`;

    const progreso = document.getElementById('progresoFotos');
    if (progreso) {
      progreso.style.width      = pct + '%';
      progreso.style.background = barColor;
    }

    const msg = document.getElementById('mensajeFotos');
    if (msg) {
      msg.textContent = pct >= 80
        ? '⚠️ Espacio casi lleno'
        : pct >= 60
          ? 'Considera limpiar fotos antiguas'
          : 'Espacio disponible';
    }
  } catch(e) {
    console.log('Error contador fotos:', e);
  }
}

function previsualizarImagen(input) {
  if (!input || !input.files || !input.files[0]) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById('imgPreview');
    const div = document.getElementById('previsualizacion');
    if (img) img.src = e.target.result;
    if (div) div.style.display = 'block';
  };
  reader.readAsDataURL(input.files[0]);
}

function previsualizarURLImagen() {
  const url = document.getElementById('productoImagenURL')?.value.trim();
  if (!url) return;
  const img = document.getElementById('imgPreview');
  const div = document.getElementById('previsualizacion');
  if (img) img.src = url;
  if (div) div.style.display = 'block';
}

async function subirImagenCloudinary() {
  const input = document.getElementById('productoImagenFile');
  if (!input || !input.files || !input.files[0]) {
    mostrarToast('Selecciona una imagen primero', 'warning');
    return;
  }

  const file = input.files[0];

  if (file.size > 10 * 1024 * 1024) {
    mostrarToast('La imagen supera 10MB', 'error');
    return;
  }
  if (!['image/jpeg','image/jpg','image/png','image/webp'].includes(file.type)) {
    mostrarToast('Formato no permitido. Usa JPG, PNG o WEBP', 'error');
    return;
  }

  const progressDiv  = document.getElementById('uploadProgress');
  const progressBar  = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  if (progressDiv) progressDiv.style.display = 'block';

  let pct = 0;
  const timer = setInterval(() => {
    pct = Math.min(pct + 8, 85);
    if (progressBar)  progressBar.style.width    = pct + '%';
    if (progressText) progressText.textContent   = pct + '%';
  }, 200);

  try {
    const formData = new FormData();
    formData.append('file',    file);
    formData.append('carpeta', 'minegocio');

    const res  = await fetch(`${API}/api/cloudinary`, {
      method: 'POST',
      body:   formData,
    });
    const data = await res.json();

    clearInterval(timer);

    if (data.success) {
      if (progressBar)  progressBar.style.width    = '100%';
      if (progressText) progressText.textContent   = '100%';

      const urlInput = document.getElementById('productoImagenURL');
      const img      = document.getElementById('imgPreview');
      const div      = document.getElementById('previsualizacion');

      if (urlInput) urlInput.value       = data.url;
      if (img)      img.src              = data.url;
      if (div)      div.style.display    = 'block';

      mostrarToast('Imagen subida ✅', 'success');
      cargarContadorFotos();

      setTimeout(() => {
        if (progressDiv) progressDiv.style.display = 'none';
      }, 1500);
    } else {
      mostrarToast('Error: ' + (data.error || 'Error desconocido'), 'error');
      if (progressDiv) progressDiv.style.display = 'none';
    }
  } catch(e) {
    clearInterval(timer);
    mostrarToast('Error de conexión al subir imagen', 'error');
    if (progressDiv) progressDiv.style.display = 'none';
  }
}
// ══════════════════════════════════════════════════════════
// GESTOR DE MEDIOS — Carga masiva de imágenes por ID
// ══════════════════════════════════════════════════════════

let colaMedias      = [];
let procesandoMedia = false;

function iniciarGestorMedios() {
  renderizarColaMedia();
}

function procesarArchivosMedia(archivos) {
  if (!archivos || archivos.length === 0) return;

  const FORMATOS = ['image/jpeg','image/jpg','image/png','image/webp'];
  const MAX_MB   = 5 * 1024 * 1024;
  const rechazados = [];

  function extraerID(nombre) {
    return nombre
      .replace(/\.[^.]+$/, '')
      .replace(/\s*\(\d+\)\s*/g, '')
      .replace(/[_\-\s]+$/, '')
      .trim()
      .toUpperCase();
  }

  const idsEnCola = new Set(colaMedias.map(f => extraerID(f.name)));

  archivos.forEach(f => {
    const id = extraerID(f.name);
    if (!FORMATOS.includes(f.type)) {
      rechazados.push(`${f.name}: formato no permitido`);
      return;
    }
    if (f.size > MAX_MB) {
      rechazados.push(`${f.name}: supera 5MB`);
      return;
    }
    if (!id.match(/^EJ\d+$/i)) {
      rechazados.push(`${f.name}: nombre debe ser tipo EJ001.jpg`);
      return;
    }
    if (idsEnCola.has(id)) {
      rechazados.push(`${f.name}: duplicado en cola`);
      return;
    }
    idsEnCola.add(id);
    colaMedias.push(f);
  });

  if (rechazados.length > 0) {
    mostrarToast(`⚠️ ${rechazados.length} archivo(s) rechazados: ${rechazados[0]}`, 'error');
  }

  renderizarColaMedia();

  if (colaMedias.length > 0) {
    mostrarToast(`✅ ${colaMedias.length} imagen(es) en cola`, 'success');
  }
}

function renderizarColaMedia() {
  const contenedor = document.getElementById('colaMedias');
  if (!contenedor) return;

  if (colaMedias.length === 0) {
    contenedor.innerHTML =
      '<p style="color:#555;font-size:13px;text-align:center;padding:20px;">La cola está vacía</p>';
    return;
  }

  contenedor.innerHTML = colaMedias.map((f, i) => {
    const id  = f.name.replace(/\.[^.]+$/, '').replace(/\s*\(\d+\)/g, '').trim().toUpperCase();
    const url = URL.createObjectURL(f);
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px;
                        background:#1e1b14;border-radius:8px;margin-bottom:6px;">
      <img src="${url}" style="width:44px;height:44px;object-fit:cover;border-radius:6px;
                                border:1px solid #333;flex-shrink:0;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;color:#ddd;white-space:nowrap;overflow:hidden;
                    text-overflow:ellipsis;">${f.name}</div>
        <div style="font-size:11px;color:var(--primary,#D4AF37);font-family:'Orbitron',monospace;">
          → ${id}
        </div>
      </div>
      <div style="font-size:11px;color:#555;flex-shrink:0;">${(f.size/1024).toFixed(0)}KB</div>
      <button onclick="quitarDeCola(${i})"
              style="background:none;border:none;color:#666;cursor:pointer;
                     font-size:18px;padding:4px;flex-shrink:0;">✕</button>
    </div>`;
  }).join('');
}

function quitarDeCola(idx) {
  colaMedias.splice(idx, 1);
  renderizarColaMedia();
}

function limpiarColaMedia() {
  colaMedias = [];
  renderizarColaMedia();
  mostrarToast('Cola limpiada', 'success');
}

async function iniciarSubidaMasiva() {
  if (colaMedias.length === 0) {
    mostrarToast('La cola está vacía. Selecciona fotos primero.', 'error');
    return;
  }
  if (procesandoMedia) return;
  procesandoMedia = true;

  const btnSubir   = document.getElementById('btnSubirMedia');
  const barraMedia = document.getElementById('barraMediaProgreso');
  const pctMedia   = document.getElementById('pctMedia');
  const msgMedia   = document.getElementById('msgMedia');
  if (btnSubir) btnSubir.disabled = true;

  let exitos = 0, omitidos = 0, erroresMedia = 0;
  const incidencias = [];

  await cargarProductos();
  const mapaProductos = {};
  productosOriginales.forEach(p => {
    mapaProductos[p.id.toUpperCase()] = p;
  });

  for (let i = 0; i < colaMedias.length; i++) {
    const f  = colaMedias[i];
    const id = f.name.replace(/\.[^.]+$/, '')
                     .replace(/\s*\(\d+\)/g, '')
                     .replace(/[_\-\s]+$/, '')
                     .trim()
                     .toUpperCase();

    const pct = Math.round(((i + 1) / colaMedias.length) * 100);
    if (barraMedia) barraMedia.style.width = pct + '%';
    if (pctMedia)   pctMedia.textContent   = pct + '%';
    if (msgMedia)   msgMedia.textContent   = `Procesando: ${f.name}`;

    const producto = mapaProductos[id];
    if (!producto) {
      erroresMedia++;
      incidencias.push({ archivo: f.name, estado: 'error', razon: `ID ${id} no existe en el sistema` });
      continue;
    }

    if (producto.imagen_url && producto.imagen_url.trim() !== '') {
      omitidos++;
      incidencias.push({ archivo: f.name, estado: 'omitida', razon: `${id} ya tiene foto asignada` });
      continue;
    }

    try {
      const formData = new FormData();
      formData.append('file',    f);
      formData.append('carpeta', 'minegocio');

      const resCloud  = await fetch(`${API}/api/cloudinary`, { method: 'POST', body: formData });
      const dataCloud = await resCloud.json();
      if (!dataCloud.success) throw new Error(dataCloud.error || 'Error Cloudinary');

      const resPut  = await fetch(`${API}/api/dashboard/productos`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...producto, imagen_url: dataCloud.url }),
      });
      const dataPut = await resPut.json();
      if (!dataPut.success) throw new Error(dataPut.error || 'Error al guardar URL');

      exitos++;
      incidencias.push({ archivo: f.name, estado: 'ok', razon: `Vinculada a ${id}` });
      mapaProductos[id] = { ...producto, imagen_url: dataCloud.url };

    } catch(e) {
      erroresMedia++;
      incidencias.push({ archivo: f.name, estado: 'error', razon: e.message });
    }

    await new Promise(r => setTimeout(r, 200));
  }

  procesandoMedia = false;
  colaMedias = [];
  await cargarProductos();
  renderizarColaMedia();
  if (barraMedia) barraMedia.style.width = '0%';
  if (pctMedia)   pctMedia.textContent   = '0%';
  if (msgMedia)   msgMedia.textContent   = 'Proceso completado';
  if (btnSubir)   btnSubir.disabled      = false;

  mostrarReporteMedia(exitos, omitidos, erroresMedia, incidencias);
}

function mostrarReporteMedia(exitos, omitidos, errores, incidencias) {
  const filas = incidencias.map(e => {
    const icono = e.estado === 'ok' ? '✅' : e.estado === 'omitida' ? '⏭️' : '❌';
    const color = e.estado === 'ok' ? '#4caf50' : e.estado === 'omitida' ? '#888' : '#c62828';
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #222;font-size:12px;color:#bbb;">
        ${icono} ${e.archivo}
      </td>
      <td style="padding:6px 10px;border-bottom:1px solid #222;font-size:12px;color:${color};">
        ${e.razon}
      </td>
    </tr>`;
  }).join('');

  const modal = document.createElement('div');
  modal.id = 'modalReporteMedia';
  modal.style.cssText =
    'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.85);' +
    'display:flex;align-items:center;justify-content:center;padding:16px;';

  modal.innerHTML = `
    <div style="background:#1a1710;border:1.5px solid var(--primary,#D4AF37);border-radius:16px;
                width:100%;max-width:560px;max-height:85vh;display:flex;flex-direction:column;">
      <div style="padding:20px 24px 16px;border-bottom:1px solid #333;flex-shrink:0;">
        <h3 style="color:var(--primary,#D4AF37);font-family:'Orbitron',sans-serif;
                   font-size:14px;letter-spacing:1px;margin-bottom:12px;">REPORTE DE CARGA MASIVA</h3>
        <div style="display:flex;gap:12px;">
          <div style="text-align:center;flex:1;background:#0d2918;border-radius:8px;padding:10px;">
            <div style="font-size:22px;font-weight:700;color:#4caf50;">${exitos}</div>
            <div style="font-size:11px;color:#888;">✅ Vinculadas</div>
          </div>
          <div style="text-align:center;flex:1;background:#1a1a1a;border-radius:8px;padding:10px;">
            <div style="font-size:22px;font-weight:700;color:#888;">${omitidos}</div>
            <div style="font-size:11px;color:#888;">⏭️ Omitidas</div>
          </div>
          <div style="text-align:center;flex:1;background:#2d0d0d;border-radius:8px;padding:10px;">
            <div style="font-size:22px;font-weight:700;color:#c62828;">${errores}</div>
            <div style="font-size:11px;color:#888;">❌ Errores</div>
          </div>
        </div>
      </div>
      <div style="overflow-y:auto;flex:1;">
        <table style="width:100%;border-collapse:collapse;">${filas}</table>
      </div>
      <div style="padding:16px 24px;border-top:1px solid #333;flex-shrink:0;">
        <button onclick="document.getElementById('modalReporteMedia').remove()"
                style="width:100%;padding:11px;background:var(--primary,#D4AF37);color:#1a1710;
                       border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;">
          Cerrar Reporte
        </button>
      </div>
    </div>`;

  document.body.appendChild(modal);
}

// ── MODAL DE IDs tras importación masiva Excel ─────────────
function mostrarModalIDs(lista) {
  const filas = lista.map(p =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #2a2520;color:#ddd;font-size:13px;">
        ${p.nombre}
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #2a2520;text-align:center;
                 color:var(--primary,#D4AF37);font-family:'Orbitron',monospace;
                 font-weight:700;font-size:13px;">
        ${p.id}
      </td>
    </tr>`
  ).join('');

  const textoParaCopiar = lista.map(p => p.id + '\t' + p.nombre).join('\n');

  const modal = document.createElement('div');
  modal.id = 'modalIDsImportados';
  modal.style.cssText =
    'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.85);' +
    'display:flex;align-items:center;justify-content:center;padding:16px;';

  modal.innerHTML = `
    <div style="background:#1a1710;border:1.5px solid var(--primary,#D4AF37);border-radius:16px;
                width:100%;max-width:520px;max-height:85vh;display:flex;flex-direction:column;">
      <div style="padding:20px 24px 16px;border-bottom:1px solid #2a2520;flex-shrink:0;">
        <div style="font-size:22px;margin-bottom:6px;">🎉</div>
        <h3 style="color:var(--primary,#D4AF37);font-size:15px;margin-bottom:4px;
                   font-family:'Orbitron',sans-serif;letter-spacing:1px;">
          IDs ASIGNADOS — ${lista.length} PRODUCTO${lista.length > 1 ? 'S' : ''}
        </h3>
        <p style="color:#888;font-size:12px;">Renombra tus fotos con estos IDs antes de ir al Gestor de Medios.</p>
      </div>
      <div style="overflow-y:auto;flex:1;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#111;position:sticky;top:0;">
              <th style="padding:10px 12px;text-align:left;color:#555;font-size:11px;
                         letter-spacing:2px;text-transform:uppercase;font-weight:500;">Nombre</th>
              <th style="padding:10px 12px;text-align:center;color:#555;font-size:11px;
                         letter-spacing:2px;text-transform:uppercase;font-weight:500;">ID</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      <div style="padding:16px 24px;border-top:1px solid #2a2520;display:flex;gap:10px;flex-shrink:0;">
        <button onclick="
          navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(textoParaCopiar)}'))
            .then(()=>mostrarToast('IDs copiados ✅','success'))
            .catch(()=>mostrarToast('No se pudo copiar','error'));
        " style="flex:1;padding:10px;background:var(--primary,#D4AF37);color:#1a1710;
                 border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;">
          <i class='fas fa-copy'></i> Copiar IDs
        </button>
        <button onclick="cambiarTab('medios');document.getElementById('modalIDsImportados').remove();"
                style="flex:1;padding:10px;background:transparent;color:var(--primary,#D4AF37);
                       border:1.5px solid var(--primary,#D4AF37);border-radius:8px;
                       font-weight:700;font-size:13px;cursor:pointer;">
          <i class='fas fa-images'></i> Ir a Medios
        </button>
        <button onclick="document.getElementById('modalIDsImportados').remove()"
                style="padding:10px 14px;background:transparent;color:#888;
                       border:1px solid #444;border-radius:8px;cursor:pointer;font-size:16px;">✕</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
}
// ── Reenviar link de seguimiento por WhatsApp ── ★
function reenviarSeguimiento(idPedido, nombreCliente, telCliente, tokenVista) {
  const urlPedido = window.location.origin.replace('elegance-panel', 'elegance-jewelry') +
                    '/pedido?id=' + idPedido + '&key=' + tokenVista;
  const tel = (telCliente || '').replace(/\D/g, '');
  const msg = encodeURIComponent(
    'Hola ' + nombreCliente + ', aquí tienes el link de seguimiento de tu pedido en Elegance Jewelry:\n\n' +
    '🔗 ' + urlPedido + '\n\n' +
    'Puedes ver el estado de tu pedido y los datos de pago en cualquier momento. ✨'
  );
  const waUrl = tel
    ? 'https://wa.me/' + tel + '?text=' + msg
    : 'https://web.whatsapp.com/send?text=' + msg;
  window.open(waUrl, '_blank');
}
// ══════════════════════════════════════════════════════════
// ORPHAN CLEANUP — Limpiar imágenes huérfanas de Cloudinary
// ══════════════════════════════════════════════════════════
async function limpiarHuerfanos() {
  const confirmado = confirm(
    '🧹 Limpiar Imágenes Huérfanas\n\n' +
    'Este proceso comparará todas las imágenes en Cloudinary contra\n' +
    'los productos en tu base de datos.\n\n' +
    'Las imágenes que estén en Cloudinary pero ya NO pertenezcan\n' +
    'a ningún producto serán eliminadas permanentemente.\n\n' +
    '¿Deseas continuar?'
  );
  if (!confirmado) return;

  mostrarToast('🔍 Analizando Cloudinary vs base de datos...', 'info');

  try {
    const res  = await fetch(`${API}/api/cloudinary`, { method: 'DELETE' });
    const data = await res.json();

    if (!data.success) {
      mostrarToast('❌ Error: ' + (data.error || 'Error desconocido'), 'error');
      return;
    }

    // Mostrar reporte en modal
    mostrarReporteHuerfanos(data);

  } catch(e) {
    mostrarToast('❌ Error de conexión: ' + e.message, 'error');
  }
}

function mostrarReporteHuerfanos(data) {
  // Si no hubo huérfanas
  if (data.huerfanas === 0) {
    const modal = document.createElement('div');
    modal.style.cssText =
      'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.85);' +
      'display:flex;align-items:center;justify-content:center;padding:16px;';
    modal.innerHTML = `
      <div style="background:#1a1710;border:1.5px solid #4caf50;border-radius:16px;
                  width:100%;max-width:420px;padding:32px;text-align:center;">
        <div style="font-size:48px;margin-bottom:12px;">✅</div>
        <h3 style="color:#4caf50;font-family:'Orbitron',sans-serif;font-size:15px;
                   letter-spacing:1px;margin-bottom:8px;">CLOUDINARY LIMPIO</h3>
        <p style="color:#888;font-size:13px;line-height:1.6;">
          Se analizaron <strong style="color:#ddd;">${data.total_cloud}</strong> imágenes en Cloudinary<br>
          y <strong style="color:#ddd;">${data.total_db}</strong> URLs en la base de datos.<br><br>
          No se encontraron imágenes huérfanas.
        </p>
        <button onclick="this.closest('[style]').remove()"
                style="margin-top:20px;width:100%;padding:11px;background:#4caf50;color:#fff;
                       border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;">
          Cerrar
        </button>
      </div>`;
    document.body.appendChild(modal);
    return;
  }

  // Reporte con huérfanas encontradas
  const detalleErrores = (data.detalle_error || []).map(e =>
    `<tr>
      <td style="padding:5px 8px;border-bottom:1px solid #222;font-size:11px;color:#bbb;">
        ${e.id}
      </td>
      <td style="padding:5px 8px;border-bottom:1px solid #222;font-size:11px;color:#c62828;">
        ${e.razon}
      </td>
    </tr>`
  ).join('');

  const modal = document.createElement('div');
  modal.style.cssText =
    'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.85);' +
    'display:flex;align-items:center;justify-content:center;padding:16px;';

  modal.innerHTML = `
    <div style="background:#1a1710;border:1.5px solid var(--primary,#D4AF37);border-radius:16px;
                width:100%;max-width:520px;max-height:85vh;display:flex;flex-direction:column;">
      <div style="padding:20px 24px 16px;border-bottom:1px solid #333;flex-shrink:0;">
        <h3 style="color:var(--primary,#D4AF37);font-family:'Orbitron',sans-serif;
                   font-size:14px;letter-spacing:1px;margin-bottom:12px;">
          🧹 REPORTE ORPHAN CLEANUP
        </h3>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:4px;">
          <div style="text-align:center;background:#111;border-radius:8px;padding:10px;">
            <div style="font-size:18px;font-weight:700;color:#aaa;">${data.total_cloud}</div>
            <div style="font-size:10px;color:#555;">En Cloudinary</div>
          </div>
          <div style="text-align:center;background:#111;border-radius:8px;padding:10px;">
            <div style="font-size:18px;font-weight:700;color:#aaa;">${data.total_db}</div>
            <div style="font-size:10px;color:#555;">En base datos</div>
          </div>
          <div style="text-align:center;background:#0d2918;border-radius:8px;padding:10px;">
            <div style="font-size:18px;font-weight:700;color:#4caf50;">${data.eliminadas}</div>
            <div style="font-size:10px;color:#888;">✅ Eliminadas</div>
          </div>
          <div style="text-align:center;background:#2d0d0d;border-radius:8px;padding:10px;">
            <div style="font-size:18px;font-weight:700;color:#c62828;">${data.errores}</div>
            <div style="font-size:10px;color:#888;">❌ Con error</div>
          </div>
        </div>
      </div>

      ${data.errores > 0 ? `
      <div style="overflow-y:auto;flex:1;padding:8px 0;">
        <p style="padding:8px 16px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">
          Errores al eliminar:
        </p>
        <table style="width:100%;border-collapse:collapse;">${detalleErrores}</table>
      </div>` : `
      <div style="padding:20px;text-align:center;color:#888;font-size:13px;">
        <p>Se eliminaron <strong style="color:#4caf50;">${data.eliminadas}</strong> imagen(es) huérfana(s) correctamente.</p>
        <p style="margin-top:8px;font-size:12px;">Cloudinary ahora solo contiene imágenes vinculadas a productos activos.</p>
      </div>`}

      <div style="padding:16px 24px;border-top:1px solid #333;flex-shrink:0;">
        <button onclick="this.closest('[style*=fixed]').remove()"
                style="width:100%;padding:11px;background:var(--primary,#D4AF37);color:#1a1710;
                       border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;">
          Cerrar Reporte
        </button>
      </div>
    </div>`;

  document.body.appendChild(modal);
}