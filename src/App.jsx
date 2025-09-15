import React, { useEffect, useMemo, useRef, useState } from "react";
import { Download, Upload, Search, Plus, Minus, Printer, Save } from "lucide-react";
import * as XLSX from "xlsx";

const HEADERS_MAP = {
  codigo: ["Codigo", "Código", "SKU", "Cod"],
  articulo: ["Articulo", "Artículo", "Nombre", "Producto", "Descripcion", "Descripción"],
  presentacion: ["Presentacion", "Presentación", "Formato"],
  precio: ["Precio", "PrecioUnitario", "PU", "Precio Unitario"],
  stock: ["Stock", "Cantidad", "Existencia"],
};

function detectHeaderKey(headers, targetList) {
  const lower = headers.map((h) => String(h || "").trim().toLowerCase());
  for (const candidate of targetList) {
    const idx = lower.indexOf(candidate.trim().toLowerCase());
    if (idx !== -1) return headers[idx];
  }
  return headers[0];
}

function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initialValue;
    } catch {
      return initialValue;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }, [key, value]);
  return [value, setValue];
}

export default function VentasApp() {
  const fileRef = useRef(null);
  const [productos, setProductos] = useLocalStorage("sv_productos", []);
  const [query, setQuery] = useState("");
  const [carrito, setCarrito] = useLocalStorage("sv_carrito", []);
  const [ticketInfo, setTicketInfo] = useLocalStorage("sv_ticket_info", {
    numero: "",
    cliente: "Consumidor Final",
    observaciones: "",
  });
  const [page, setPage] = useState("stock"); // stock | facturacion
  const [qFact, setQFact] = useState("");     // buscador de facturación por nombre/código/presentación

  useEffect(() => {
    if (!ticketInfo.numero) {
      const ts = new Date();
      const num = `T-${ts.getFullYear()}${String(ts.getMonth()+1).padStart(2,"0")}${String(ts.getDate()).padStart(2,"0")}-${String(ts.getHours()).padStart(2,"0")}${String(ts.getMinutes()).padStart(2,"0")}${String(ts.getSeconds()).padStart(2,"0")}`;
      setTicketInfo((s) => ({ ...s, numero: num }));
    }
  }, []); // eslint-disable-line

  // Filtro para STOCK (muestra todas las columnas incluido Stock)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return productos;
    return productos.filter((p) =>
      [p.codigo, p.articulo, p.presentacion]
        .map((v) => String(v || "").toLowerCase())
        .some((v) => v.includes(q))
    );
  }, [query, productos]);

  const total = useMemo(() => carrito.reduce((acc, it) => acc + it.precio * it.cantidad, 0), [carrito]);

  function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target.result);
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      const [headers, ...rows] = json;
      if (!headers) return;

      const hCodigo = detectHeaderKey(headers, HEADERS_MAP.codigo);
      const hArticulo = detectHeaderKey(headers, HEADERS_MAP.articulo);
      const hPresentacion = detectHeaderKey(headers, HEADERS_MAP.presentacion);
      const hPrecio = detectHeaderKey(headers, HEADERS_MAP.precio);
      const hStock = detectHeaderKey(headers, HEADERS_MAP.stock);

      const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

      const parsed = rows
        .filter((r) => r && r.length)
        .map((r) => ({
          codigo: String(r[idx[hCodigo]] ?? "").trim(),
          articulo: String(r[idx[hArticulo]] ?? "").trim(),
          presentacion: String(r[idx[hPresentacion]] ?? "").trim(),
          precio: Number(String(r[idx[hPrecio]] ?? "0").replace(",", ".")) || 0,
          stock: Number(String(r[idx[hStock]] ?? "0").replace(",", ".")) || 0,
        }))
        .filter((p) => p.articulo || p.codigo);

      setProductos(parsed);
    };
    reader.readAsArrayBuffer(file);
  }

  function exportarExcel() {
    const ws = XLSX.utils.json_to_sheet(productos);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stock");
    XLSX.writeFile(wb, `stock_actual_${hoyNombre()}.xlsx`);
  }

  function hoyNombre() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  function agregarAlCarrito(prod) {
    setCarrito((prev) => {
      const i = prev.findIndex((x) => x.codigo === prod.codigo);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], cantidad: next[i].cantidad + 1 };
        return next;
      }
      return [
        ...prev,
        { codigo: prod.codigo, articulo: prod.articulo, presentacion: prod.presentacion, precio: prod.precio, cantidad: 1 },
      ];
    });
  }

  function cambiarCantidad(codigo, delta) {
    setCarrito((prev) => {
      const idx = prev.findIndex((x) => x.codigo === codigo);
      if (idx === -1) return prev;
      const next = [...prev];
      const nueva = Math.max(0, next[idx].cantidad + delta);
      if (nueva === 0) next.splice(idx, 1); else next[idx] = { ...next[idx], cantidad: nueva };
      return next;
    });
  }

  function quitarDelCarrito(codigo) {
    setCarrito((prev) => prev.filter((x) => x.codigo !== codigo));
  }

  function confirmarVenta() {
    if (!carrito.length) return;
    const venta = {
      numero: ticketInfo.numero,
      fecha: new Date().toISOString(),
      cliente: ticketInfo.cliente,
      observaciones: ticketInfo.observaciones,
      items: carrito,
      total,
    };
    const ws = XLSX.utils.json_to_sheet(
      [
        { Ticket: venta.numero, Fecha: venta.fecha, Cliente: venta.cliente, Total: venta.total },
        {},
        { Codigo: "Código", Articulo: "Artículo", Presentacion: "Presentación", Cantidad: "Cantidad", Precio: "Precio", Subtotal: "Subtotal" },
        ...venta.items.map((i) => ({
          Codigo: i.codigo,
          Articulo: i.articulo,
          Presentacion: i.presentacion,
          Cantidad: i.cantidad,
          Precio: i.precio,
          Subtotal: i.precio * i.cantidad,
        })),
      ],
      { skipHeader: true }
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Comprobante");
    XLSX.writeFile(wb, `venta_${venta.numero}.xlsx`);
    setCarrito([]);
    setTicketInfo((s) => ({ ...s, numero: "" }));
    alert("Venta confirmada.");
  }

  return (
    <div className="min-h-screen w-full bg-gray-50 p-4 md:p-8">
      <div className="mx-auto max-w-7xl">
        <style>{`
          @media print {
            body * { visibility: hidden; }
            .printable, .printable * { visibility: visible; }
            .printable { position: absolute; left: 0; top: 0; width: 100%; }
            .no-print { display: none !important; }
          }
        `}</style>

        <div className="mb-6 flex gap-2 no-print">
          <button onClick={()=>setPage("stock")} className={`px-3 py-2 rounded-md border ${page==='stock'?'bg-black text-white border-black':'bg-white'}`}>Stock</button>
          <button onClick={()=>setPage("facturacion")} className={`px-3 py-2 rounded-md border ${page==='facturacion'?'bg-black text-white border-black':'bg-white'}`}>Facturación</button>
        </div>

        {/* PÁGINA STOCK (con columna Stock) */}
        {page === "stock" && (
          <div className="space-y-4">
            <div className="flex gap-2 mb-4 no-print">
              <button onClick={() => fileRef.current?.click()} className="px-3 py-2 border rounded-md bg-white"><Upload className="mr-2 h-4 w-4"/> Importar Excel</button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
              <button onClick={exportarExcel} className="px-3 py-2 border rounded-md bg-white"><Download className="mr-2 h-4 w-4"/> Exportar Stock</button>
              <div className="relative md:w-1/3 ml-auto">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500"/>
                <input
                  className="w-full rounded-md border px-9 py-2 text-sm"
                  placeholder="Buscar en Stock (código / artículo / presentación)"
                  value={query}
                  onChange={(e)=>setQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="rounded-2xl border bg-white overflow-hidden">
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white shadow">
                    <tr className="text-left">
                      <th className="p-3">Código</th>
                      <th className="p-3">Artículo</th>
                      <th className="p-3">Presentación</th>
                      <th className="p-3 text-right">Precio (ARS)</th>
                      <th className="p-3 text-right">Stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p, idx) => (
                      <tr key={`${p.codigo || "x"}_${p.articulo || "x"}_${idx}`} className="border-t hover:bg-gray-50">
                        <td className="p-3 font-mono">{p.codigo}</td>
                        <td className="p-3">{p.articulo}</td>
                        <td className="p-3 text-gray-600">{p.presentacion}</td>
                        <td className="p-3 text-right">{p.precio.toLocaleString("es-AR", { style: "currency", currency: "ARS" })}</td>
                        <td className="p-3 text-right">{p.stock}</td>
                      </tr>
                    ))}
                    {!filtered.length && (
                      <tr><td className="p-6 text-center text-gray-500" colSpan={5}>Sin resultados en Stock.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* PÁGINA FACTURACIÓN: barra sticky + bloque imprimible */}
        {page === "facturacion" && (
          <div className="space-y-4">
            {/* Barra fija con total y acciones (no se imprime) */}
            <div className="sticky top-0 z-30 border rounded-2xl bg-white/90 backdrop-blur p-3 flex flex-col md:flex-row md:items-center gap-3 no-print">
              <div className="text-sm md:text-base font-semibold">Carrito: {carrito.length} ítems</div>
              <div className="md:ml-auto flex flex-wrap items-center gap-2">
                <span className="text-sm">Total: <b>{total.toLocaleString("es-AR", { style: "currency", currency: "ARS" })}</b></span>
                <button onClick={confirmarVenta} className="px-3 py-2 rounded-md border bg-black text-white flex items-center gap-2"><Save className="h-4 w-4"/>Confirmar venta</button>
                <button onClick={()=>window.print()} className="px-3 py-2 rounded-md border bg-white flex items-center gap-2"><Printer className="h-4 w-4"/>Imprimir</button>
              </div>
            </div>

            {/* Bloque imprimible (solo esto sale en papel) */}
            <div className="rounded-2xl border bg-white p-4 printable">
              <h2 className="text-lg font-semibold mb-2">Detalle de facturación</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="p-3">Artículo</th>
                    <th className="p-3">Cantidad</th>
                    <th className="p-3 text-right">Precio</th>
                    <th className="p-3 text-right">Subtotal</th>
                    <th className="no-print"></th>
                  </tr>
                </thead>
                <tbody>
                  {carrito.map((c, idx) => (
                    <tr key={`${c.codigo || "x"}_${c.articulo || "x"}_${idx}`} className="border-t">
                      <td className="p-3">{c.articulo}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2 no-print">
                          <button onClick={()=>cambiarCantidad(c.codigo, -1)} className="px-2 py-1 border rounded">-</button>
                          <span>{c.cantidad}</span>
                          <button onClick={()=>cambiarCantidad(c.codigo, 1)} className="px-2 py-1 border rounded">+</button>
                        </div>
                        <span className="print-only">{c.cantidad}</span>
                      </td>
                      <td className="p-3 text-right">{c.precio.toLocaleString("es-AR", { style: "currency", currency: "ARS" })}</td>
                      <td className="p-3 text-right">{(c.precio*c.cantidad).toLocaleString("es-AR", { style: "currency", currency: "ARS" })}</td>
                      <td className="no-print">
                        <button onClick={()=>quitarDelCarrito(c.codigo)} className="px-2 py-1 text-xs border rounded">x</button>
                      </td>
                    </tr>
                  ))}
                  {!carrito.length && (
                    <tr><td className="p-4 text-sm text-gray-500" colSpan={5}>No hay productos en el carrito.</td></tr>
                  )}
                </tbody>
              </table>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-sm">N° Ticket</label>
                  <input className="w-full rounded-md border px-3 py-2 text-sm no-print" value={ticketInfo.numero} onChange={(e)=>setTicketInfo({...ticketInfo, numero: e.target.value})} />
                  <div className="print-only">{ticketInfo.numero}</div>
                </div>
                <div>
                  <label className="text-sm">Cliente</label>
                  <input className="w-full rounded-md border px-3 py-2 text-sm no-print" value={ticketInfo.cliente} onChange={(e)=>setTicketInfo({...ticketInfo, cliente: e.target.value})} />
                  <div className="print-only">{ticketInfo.cliente}</div>
                </div>
                <div>
                  <label className="text-sm">Observaciones</label>
                  <input className="w-full rounded-md border px-3 py-2 text-sm no-print" value={ticketInfo.observaciones} onChange={(e)=>setTicketInfo({...ticketInfo, observaciones: e.target.value})} />
                  <div className="print-only">{ticketInfo.observaciones}</div>
                </div>
              </div>

              <div className="mt-4 flex justify-between font-semibold">
                <span>Total</span>
                <span>{total.toLocaleString("es-AR", { style: "currency", currency: "ARS" })}</span>
              </div>
            </div>

            {/* Buscador y lista (ABAJO) */}
            <div className="rounded-2xl border bg-white no-print">
              <div className="p-4 border-b flex items-center gap-2">
                <div className="relative w-full md:w-1/2">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500"/>
                  <input
                    className="w-full rounded-md border px-9 py-2 text-sm"
                    placeholder="Buscar por nombre, código o presentación..."
                    value={qFact}
                    onChange={(e)=>setQFact(e.target.value)}
                  />
                  {qFact && (
                    <button
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs border rounded px-2 py-1 bg-white"
                      onClick={()=>setQFact("")}
                      type="button"
                    >
                      Limpiar
                    </button>
                  )}
                </div>
              </div>

              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white shadow">
                    <tr className="text-left">
                      <th className="p-3">Código</th>
                      <th className="p-3">Artículo</th>
                      <th className="p-3">Presentación</th>
                      <th className="p-3 text-right">Precio (ARS)</th>
                      <th className="p-3 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productos
                      .filter((p) => {
                        const q = qFact.trim().toLowerCase();
                        if (!q) return true;
                        return [p.codigo, p.articulo, p.presentacion].map(v=>String(v||"").toLowerCase()).some(v=>v.includes(q));
                      })
                      .map((p, idx) => (
                        <tr key={`${p.codigo || "x"}_${p.articulo || "x"}_${idx}`} className="border-t hover:bg-gray-50">
                          <td className="p-3 font-mono">{p.codigo}</td>
                          <td className="p-3">{p.articulo}</td>
                          <td className="p-3 text-gray-600">{p.presentacion}</td>
                          <td className="p-3 text-right">{p.precio.toLocaleString("es-AR", { style: "currency", currency: "ARS" })}</td>
                          <td className="p-3 text-right">
                            <button onClick={()=>agregarAlCarrito(p)} className="px-2 py-1 text-xs rounded-md border bg-black text-white">
                              <Plus className="mr-1 h-4 w-4"/>Agregar
                            </button>
                          </td>
                        </tr>
                      ))}
                    {!productos.length && (
                      <tr><td className="p-6 text-center text-gray-500" colSpan={5}>No hay productos cargados.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
