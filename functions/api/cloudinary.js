// functions/api/cloudinary.js
// Upload de imágenes a Cloudinary (unsigned preset)
// y consulta del contador de fotos por carpeta

export async function onRequestPost(context) {
  const { request } = context;

  try {
    const formData = await request.formData();
    const file     = formData.get('file');
    const carpeta  = formData.get('carpeta') || 'minegocio';

    if (!file) {
      return Response.json({ success: false, error: 'No se recibió imagen' }, { status: 400 });
    }

    // Validar tamaño (máx 10MB)
    if (file.size > 10 * 1024 * 1024) {
      return Response.json({ success: false, error: 'La imagen supera 10MB' }, { status: 400 });
    }

    // Validar tipo
    const tiposPermitidos = ['image/jpeg','image/jpg','image/png','image/webp'];
    if (!tiposPermitidos.includes(file.type)) {
      return Response.json({ success: false, error: 'Formato no permitido. Usa JPG, PNG o WEBP' }, { status: 400 });
    }

    // Subir a Cloudinary con preset unsigned
    const CLOUD_NAME = 'doaqu6s6c';
    const PRESET     = 'tienda';

    const upload = new FormData();
    upload.append('file',          file);
    upload.append('upload_preset', PRESET);
    upload.append('folder',        carpeta);

    const res  = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
      { method: 'POST', body: upload }
    );

    if (!res.ok) {
      const err = await res.text();
      return Response.json({ success: false, error: 'Cloudinary: ' + err }, { status: 500 });
    }

    const data = await res.json();

    return Response.json({
      success:    true,
      url:        data.secure_url,
      public_id:  data.public_id,
      width:      data.width,
      height:     data.height,
    });

  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}

// GET → contar fotos en una carpeta
export async function onRequestGet(context) {
  const { request } = context;
  const url     = new URL(request.url);
  const carpeta = url.searchParams.get('carpeta') || 'minegocio';

  try {
    const CLOUD_NAME = 'doaqu6s6c';
    const API_KEY    = '978137972327483';
    // El secret se pone como variable de entorno en Cloudflare
    const API_SECRET = context.env.CLOUDINARY_SECRET || '';

    const auth    = btoa(`${API_KEY}:${API_SECRET}`);
    const res     = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/image/upload?prefix=${carpeta}&max_results=1`,
      { headers: { 'Authorization': `Basic ${auth}` } }
    );

    if (!res.ok) {
      return Response.json({ success: true, total: 0, limite: 200 });
    }

    const data  = await res.json();
    const total = data.total_count || 0;

    return Response.json({ success: true, total, limite: 200 });

  } catch (err) {
    return Response.json({ success: true, total: 0, limite: 200 });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

// ── DELETE — Orphan Cleanup ────────────────────────────────
// Compara imágenes en Cloudinary vs URLs en D1
// Elimina las que están en Cloudinary pero ya no en ningún producto
export async function onRequestDelete(context) {
  const { env } = context;

  try {
    const CLOUD_NAME = 'doaqu6s6c';
    const API_KEY    = '978137972327483';
    const API_SECRET = context.env.CLOUDINARY_SECRET || '';
    const auth       = btoa(`${API_KEY}:${API_SECRET}`);

    // ── Paso 1: Obtener TODAS las URLs de imagen de D1 ────
    // Incluye productos activos e inactivos para no borrar lo que aún referencia
    const { results: productos } = await env.elegance_db
      .prepare('SELECT imagen_url FROM productos WHERE imagen_url IS NOT NULL AND imagen_url != ""')
      .all();

    const urlsEnDB = new Set(
      productos.map(p => p.imagen_url.trim()).filter(Boolean)
    );

    // ── Paso 2: Obtener TODAS las imágenes de Cloudinary ──
    const todasEnCloud = [];
    let nextCursor = null;

    do {
      const qs  = new URLSearchParams({
        prefix:      'minegocio',
        max_results: '500',
        ...(nextCursor ? { next_cursor: nextCursor } : {}),
      });

      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/image/upload?${qs}`,
        { headers: { Authorization: `Basic ${auth}` } }
      );

      if (!res.ok) {
        return Response.json(
          { success: false, error: 'Error consultando Cloudinary: ' + await res.text() },
          { status: 500 }
        );
      }

      const data = await res.json();
      todasEnCloud.push(...(data.resources || []));
      nextCursor = data.next_cursor || null;

    } while (nextCursor);

    // ── Paso 3: Detectar huérfanas ─────────────────────────
    // Una imagen es huérfana si su secure_url NO está en ningún producto de D1
    const huerfanas = todasEnCloud.filter(img =>
      !urlsEnDB.has(img.secure_url)
    );

    if (huerfanas.length === 0) {
      return Response.json({
        success:    true,
        eliminadas: 0,
        errores:    0,
        detalle:    [],
        mensaje:    'No se encontraron imágenes huérfanas. Cloudinary está limpio ✅',
      });
    }

    // ── Paso 4: Eliminar huérfanas de Cloudinary ──────────
    const publicIds  = huerfanas.map(img => img.public_id);
    const eliminadas = [];
    const errores    = [];

    // Cloudinary permite eliminar hasta 100 por lote
    for (let i = 0; i < publicIds.length; i += 100) {
      const lote = publicIds.slice(i, i + 100);

      // Generar firma para delete
      const timestamp = Math.floor(Date.now() / 1000);
      const toSign    = `public_ids[]=${lote.join('&public_ids[]=')}&timestamp=${timestamp}${API_SECRET}`;

      // Usar crypto para SHA1
      const encoder = new TextEncoder();
      const keyData = encoder.encode(toSign);
      const hashBuffer = await crypto.subtle.digest('SHA-1', keyData);
      const hashArray  = Array.from(new Uint8Array(hashBuffer));
      const signature  = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      const formData = new FormData();
      lote.forEach(id => formData.append('public_ids[]', id));
      formData.append('timestamp', timestamp);
      formData.append('api_key',   API_KEY);
      formData.append('signature', signature);

      const delRes = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/destroy_all`,
        { method: 'POST', body: formData }
      );

      if (delRes.ok) {
        const delData = await delRes.json();
        // Cloudinary devuelve deleted: { public_id: 'deleted' } o 'not_found'
        Object.entries(delData.deleted || {}).forEach(([id, status]) => {
          if (status === 'deleted') eliminadas.push(id);
          else errores.push({ id, razon: status });
        });
      } else {
        lote.forEach(id => errores.push({ id, razon: 'Error HTTP ' + delRes.status }));
      }
    }

    return Response.json({
      success:    true,
      total_cloud:   todasEnCloud.length,
      total_db:      urlsEnDB.size,
      huerfanas:     huerfanas.length,
      eliminadas:    eliminadas.length,
      errores:       errores.length,
      detalle_error: errores.slice(0, 20),
    });

  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}