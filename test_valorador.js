"use server";
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFactoresMercado = getFactoresMercado;
exports.getZonasStats = getZonasStats;
exports.getComparablesBarrio = getComparablesBarrio;
exports.getComparablesRadio = getComparablesRadio;
exports.geocodificar = geocodificar;
exports.buscarCatastro = buscarCatastro;
exports.getValoraciones = getValoraciones;
exports.crearValoracion = crearValoracion;
exports.eliminarValoracion = eliminarValoracion;
const server_1 = require("@/lib/supabase/server");
const cache_1 = require("next/cache");
function mediana(nums) {
    if (!nums.length)
        return null;
    const s = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
// Coeficientes calculados a partir del mercado real (data-backed).
function getFactoresMercado() {
    return __awaiter(this, arguments, void 0, function* (operacion = "venta") {
        const supabase = yield (0, server_1.createAdminClient)();
        const { data } = yield supabase
            .from("mercado_inmuebles")
            .select("ascensor, precio_m2")
            .eq("operacion", operacion)
            .eq("activo", true)
            .not("precio_m2", "is", null);
        const rows = (data !== null && data !== void 0 ? data : []);
        const con = rows.filter((r) => r.ascensor === true).map((r) => r.precio_m2);
        const sin = rows.filter((r) => r.ascensor === false).map((r) => r.precio_m2);
        const mCon = mediana(con);
        const mSin = mediana(sin);
        // Ratio sin/con, acotado a un rango sensato para evitar distorsiones por muestras pequeñas
        let factor = 0.9;
        if (mCon && mSin && mCon > 0) {
            factor = Math.min(1, Math.max(0.8, mSin / mCon));
        }
        return { ascensorFactor: Math.round(factor * 100) / 100, muestraAscensor: con.length + sin.length };
    });
}
// Stats €/m² por barrio para una operación. Devuelve mapa codbarrio -> stat.
function getZonasStats() {
    return __awaiter(this, arguments, void 0, function* (operacion = "venta") {
        const supabase = yield (0, server_1.createAdminClient)();
        const { data, error } = yield supabase
            .from("mercado_zonas_stats")
            .select("*")
            .eq("operacion", operacion);
        if (error)
            return [];
        return (data !== null && data !== void 0 ? data : []);
    });
}
// Comparables individuales de un barrio para ver y filtrar en el Valorador
function getComparablesBarrio(codbarrio_1) {
    return __awaiter(this, arguments, void 0, function* (codbarrio, operacion = "venta") {
        const supabase = yield (0, server_1.createAdminClient)();
        const { data, error } = yield supabase
            .from("mercado_inmuebles")
            .select("id, idealista_id, operacion, tipo, codbarrio, barrio, lat, lng, precio, metros, precio_m2, habitaciones, banos, planta, ascensor, anunciante, agencia_nombre, fecha_ultima_vista")
            .eq("codbarrio", codbarrio)
            .eq("operacion", operacion)
            .eq("activo", true)
            .not("precio_m2", "is", null)
            .order("precio_m2", { ascending: true });
        if (error)
            return [];
        return (data !== null && data !== void 0 ? data : []);
    });
}
function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000; // metros
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.pow(Math.sin(dLng / 2), 2);
    return 2 * R * Math.asin(Math.sqrt(a));
}
// Comparables dentro de un radio (metros) alrededor de un punto. Estilo "BetterPlace".
function getComparablesRadio(lat_1, lng_1, radioMetros_1) {
    return __awaiter(this, arguments, void 0, function* (lat, lng, radioMetros, operacion = "venta") {
        const supabase = yield (0, server_1.createAdminClient)();
        // Bounding box para reducir la consulta; luego se afina con haversine.
        const dLat = radioMetros / 111320;
        const dLng = radioMetros / (111320 * Math.cos((lat * Math.PI) / 180) || 1);
        const { data, error } = yield supabase
            .from("mercado_inmuebles")
            .select("id, idealista_id, operacion, tipo, codbarrio, barrio, lat, lng, precio, metros, precio_m2, habitaciones, banos, planta, ascensor, anunciante, agencia_nombre, fecha_ultima_vista")
            .eq("operacion", operacion)
            .eq("activo", true)
            .not("precio_m2", "is", null)
            .not("lat", "is", null)
            .gte("lat", lat - dLat).lte("lat", lat + dLat)
            .gte("lng", lng - dLng).lte("lng", lng + dLng);
        if (error)
            return [];
        const rows = (data !== null && data !== void 0 ? data : []);
        return rows
            .filter((r) => r.lat != null && r.lng != null && haversine(lat, lng, r.lat, r.lng) <= radioMetros)
            .sort((a, b) => a.precio_m2 - b.precio_m2);
    });
}
// Geocodificación de una dirección con CartoCiudad (IGN, gratis, sin key).
function geocodificar(direccion) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const dirTrim = direccion.trim();
        if (!dirTrim)
            return null;
        const qDir = /valencia|torrent|gandia|paterna|mislata|sagunto|alzira/i.test(dirTrim) ? dirTrim : `${dirTrim}, Valencia`;
        const q = encodeURIComponent(qDir);
        try {
            const res = yield fetch(`https://www.cartociudad.es/geocoder/api/geocoder/find?q=${q}`, {
                headers: { Accept: "application/json" },
            });
            if (!res.ok)
                return null;
            const d = yield res.json();
            if (d == null || d.lat == null || d.lng == null)
                return null;
            const dir = [d.tip_via, d.address, d.portalNumber].filter(Boolean).join(" ");
            return {
                lat: Number(d.lat),
                lng: Number(d.lng),
                direccion: dir || dirTrim,
                refCatastral: (_a = d.refCatastral) !== null && _a !== void 0 ? _a : null,
                tip_via: d.tip_via,
                address: d.address,
                portalNumber: d.portalNumber != null ? Number(d.portalNumber) : null,
                muni: d.muni,
                province: d.province,
            };
        }
        catch (_b) {
            return null;
        }
    });
}
const _norm = (s) => (s !== null && s !== void 0 ? s : "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
const TIPVIA_SIGLA = {
    CALLE: "CL", CARRER: "CL", CL: "CL",
    AVENIDA: "AV", AVINGUDA: "AV", AV: "AV",
    PLAZA: "PZ", PLACA: "PZ", PZ: "PZ",
    PASEO: "PS", PASSEIG: "PS", PS: "PS",
    CAMINO: "CM", CAMI: "CM", CM: "CM",
    RONDA: "RD", RD: "RD",
    CARRETERA: "CR", CR: "CR",
    TRAVESIA: "TR", TR: "TR",
    "GRAN VIA": "GV", GRANVIA: "GV", GV: "GV",
    VIA: "VI", VI: "VI", MERCADO: "CL",
};
// Extrae fincas del JSON del Catastro (tanto lrcdnp con división horizontal como bico único)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseCatastroUnits(result) {
    var _a, _b;
    if (!result)
        return [];
    // Formato 1: lrcdnp (edificio con división horizontal / múltiples fincas)
    if ((_a = result.lrcdnp) === null || _a === void 0 ? void 0 : _a.rcdnp) {
        let list = result.lrcdnp.rcdnp;
        if (!Array.isArray(list))
            list = [list];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return list.map((u) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
            const rc = (_a = u.rc) !== null && _a !== void 0 ? _a : {};
            const loint = (_f = (_e = (_d = (_c = (_b = u.dt) === null || _b === void 0 ? void 0 : _b.locs) === null || _c === void 0 ? void 0 : _c.lous) === null || _d === void 0 ? void 0 : _d.lourb) === null || _e === void 0 ? void 0 : _e.loint) !== null && _f !== void 0 ? _f : {};
            const debi = (_g = u.debi) !== null && _g !== void 0 ? _g : {};
            return {
                rc: `${(_h = rc.pc1) !== null && _h !== void 0 ? _h : ""}${(_j = rc.pc2) !== null && _j !== void 0 ? _j : ""}${(_k = rc.car) !== null && _k !== void 0 ? _k : ""}${(_l = rc.cc1) !== null && _l !== void 0 ? _l : ""}${(_m = rc.cc2) !== null && _m !== void 0 ? _m : ""}`,
                planta: (_o = loint.pt) !== null && _o !== void 0 ? _o : "",
                puerta: (_p = loint.pu) !== null && _p !== void 0 ? _p : "",
                escalera: (_q = loint.es) !== null && _q !== void 0 ? _q : "",
                uso: (_r = debi.luso) !== null && _r !== void 0 ? _r : "—",
                superficie: debi.sfc != null ? Number(debi.sfc) : null,
                anio: (_s = debi.ant) !== null && _s !== void 0 ? _s : null,
            };
        });
    }
    // Formato 2: bico (inmueble único sin división horizontal)
    if ((_b = result.bico) === null || _b === void 0 ? void 0 : _b.bi) {
        let list = result.bico.bi;
        if (!Array.isArray(list))
            list = [list];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return list.map((u) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t;
            const rc = (_b = (_a = u.idbi) === null || _a === void 0 ? void 0 : _a.rc) !== null && _b !== void 0 ? _b : {};
            const loint = (_g = (_f = (_e = (_d = (_c = u.dt) === null || _c === void 0 ? void 0 : _c.locs) === null || _d === void 0 ? void 0 : _d.lous) === null || _e === void 0 ? void 0 : _e.lourb) === null || _f === void 0 ? void 0 : _f.loint) !== null && _g !== void 0 ? _g : {};
            const debi = (_h = u.debi) !== null && _h !== void 0 ? _h : {};
            return {
                rc: `${(_j = rc.pc1) !== null && _j !== void 0 ? _j : ""}${(_k = rc.pc2) !== null && _k !== void 0 ? _k : ""}${(_l = rc.car) !== null && _l !== void 0 ? _l : ""}${(_m = rc.cc1) !== null && _m !== void 0 ? _m : ""}${(_o = rc.cc2) !== null && _o !== void 0 ? _o : ""}`,
                planta: (_p = loint.pt) !== null && _p !== void 0 ? _p : "",
                puerta: (_q = loint.pu) !== null && _q !== void 0 ? _q : "",
                escalera: (_r = loint.es) !== null && _r !== void 0 ? _r : "",
                uso: (_s = debi.luso) !== null && _s !== void 0 ? _s : "—",
                superficie: debi.sfc != null ? Number(debi.sfc) : null,
                anio: (_t = debi.ant) !== null && _t !== void 0 ? _t : null,
            };
        });
    }
    return [];
}
// Consulta DNPLOC a la API del Catastro
function consultarCatastroDNPLOC(provincia, municipio, sigla, calle, numero) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            const url = `https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCallejero.svc/json/Consulta_DNPLOC`
                + `?Provincia=${encodeURIComponent(provincia)}&Municipio=${encodeURIComponent(municipio)}`
                + `&Sigla=${encodeURIComponent(sigla)}&Calle=${encodeURIComponent(calle)}`
                + `&Numero=${encodeURIComponent(String(numero))}`;
            const dres = yield fetch(url, { headers: { Accept: "application/json" } });
            if (!dres.ok)
                return null;
            const text = yield dres.text();
            const dj = JSON.parse(text.replace(/^\uFEFF/, ""));
            const result = dj === null || dj === void 0 ? void 0 : dj.consulta_dnplocResult;
            if (!result)
                return null;
            const units = parseCatastroUnits(result);
            if (units.length > 0)
                return units;
            // Si el número exacto no tiene fincas pero Catastro devuelve números de portal cercanos
            if (((_a = result.control) === null || _a === void 0 ? void 0 : _a.cunum) > 0 && ((_b = result.numerero) === null || _b === void 0 ? void 0 : _b.nump)) {
                let numps = result.numerero.nump;
                if (!Array.isArray(numps))
                    numps = [numps];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const candidateNums = numps.map((x) => { var _a; return parseInt((_a = x.num) === null || _a === void 0 ? void 0 : _a.pnp); }).filter((n) => !isNaN(n));
                if (candidateNums.length > 0) {
                    candidateNums.sort((a, b) => Math.abs(a - numero) - Math.abs(b - numero));
                    return { fallbackNum: candidateNums[0] };
                }
            }
            return null;
        }
        catch (_c) {
            return null;
        }
    });
}
// Dirección → geocode (CartoCiudad) + fincas del Catastro (DNPLOC): pisos, puertas, uso, m².
function buscarCatastro(direccion) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const geo = yield geocodificar(direccion);
        if (!geo)
            return null;
        const base = { lat: geo.lat, lng: geo.lng, direccion: geo.direccion, unidades: [] };
        let numero = geo.portalNumber;
        if (numero == null) {
            const mNum = direccion.match(/\b(\d{1,4})\b/);
            if (mNum)
                numero = parseInt(mNum[1]);
        }
        if (numero == null)
            return base;
        let provincia = _norm(((_a = geo.province) !== null && _a !== void 0 ? _a : "VALENCIA").split("/")[0]);
        if (provincia.includes("VALENC"))
            provincia = "VALENCIA";
        let municipio = _norm((_b = geo.muni) !== null && _b !== void 0 ? _b : "VALENCIA");
        if (municipio.includes("VALENC"))
            municipio = "VALENCIA";
        const siglaOrig = (_d = TIPVIA_SIGLA[_norm((_c = geo.tip_via) !== null && _c !== void 0 ? _c : "")]) !== null && _d !== void 0 ? _d : "CL";
        const rawAddress = (_e = geo.address) !== null && _e !== void 0 ? _e : "";
        const cleanStr = _norm(rawAddress);
        const rawParts = cleanStr.split("/").map((s) => s.trim()).filter(Boolean);
        const calleVariants = new Set();
        for (const p of rawParts) {
            calleVariants.add(p);
            calleVariants.add(`${p} DEL`);
            calleVariants.add(`${p} DE LA`);
            calleVariants.add(`DEL ${p}`);
            calleVariants.add(`DE LA ${p}`);
            // Reemplazos de títulos habituales (DOCTOR -> DR, SANTA -> STA, etc.)
            const drStr = p.replace(/\bDOCTOR\b/g, "DR")
                .replace(/\bDOCTORA\b/g, "DRA")
                .replace(/\bPROFESOR\b/g, "PROF")
                .replace(/\bARQUITECTO\b/g, "ARQ")
                .replace(/\bINGENIERO\b/g, "ING")
                .replace(/\bSANTA\b/g, "STA")
                .replace(/\bGENERAL\b/g, "GEN");
            if (drStr !== p) {
                calleVariants.add(drStr);
                calleVariants.add(`${drStr} DEL`);
                calleVariants.add(`${drStr} DE LA`);
            }
            // Eliminación de títulos e iniciales
            const noTitle = p.replace(/^(DOCTOR|DOCTORA|DR|DRA|PROFESOR|PROF|ARQUITECTO|ARQ|INGENIERO|ING|GENERAL|GEN|SANTA|STA|SANT|SAN|DON|DOÑA|DE LA|DEL|DE|DES|DOS)\s+/, "");
            if (noTitle !== p) {
                calleVariants.add(noTitle);
                calleVariants.add(`${noTitle} DEL`);
                calleVariants.add(`${noTitle} DE LA`);
            }
        }
        const siglasToTry = [siglaOrig];
        for (const s of ["CL", "AV", "PZ", "GV", "PS", "CR", "RD"]) {
            if (!siglasToTry.includes(s))
                siglasToTry.push(s);
        }
        const fallbacks = [];
        // FASE 1: Buscar coincidencia exacta con el portal pedido
        for (const calleVar of calleVariants) {
            for (const sig of siglasToTry) {
                const res = yield consultarCatastroDNPLOC(provincia, municipio, sig, calleVar, numero);
                if (Array.isArray(res) && res.length > 0) {
                    base.unidades = res;
                    return base;
                }
                else if (res && typeof res === "object" && "fallbackNum" in res) {
                    fallbacks.push({ provincia, municipio, sig, calleVar, fallbackNum: res.fallbackNum });
                }
            }
        }
        // FASE 2: Si no hubo fincas en el portal exacto, intentar el portal más cercano devuelto por el Catastro
        if (fallbacks.length > 0) {
            for (const fb of fallbacks) {
                const res = yield consultarCatastroDNPLOC(fb.provincia, fb.municipio, fb.sig, fb.calleVar, fb.fallbackNum);
                if (Array.isArray(res) && res.length > 0) {
                    base.unidades = res;
                    return base;
                }
            }
        }
        return base;
    });
}
function getValoraciones() {
    return __awaiter(this, void 0, void 0, function* () {
        const supabase = yield (0, server_1.createAdminClient)();
        const { data, error } = yield supabase
            .from("valoraciones")
            .select("*, autor:perfiles!valoraciones_creada_por_fkey(nombre, apellidos)")
            .order("creada_en", { ascending: false })
            .limit(200);
        if (error)
            return [];
        return (data !== null && data !== void 0 ? data : []).map((row) => {
            var _a, _b;
            return (Object.assign(Object.assign({}, row), { autor: Array.isArray(row.autor) ? ((_a = row.autor[0]) !== null && _a !== void 0 ? _a : null) : ((_b = row.autor) !== null && _b !== void 0 ? _b : null) }));
        });
    });
}
function crearValoracion(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const supabase = yield (0, server_1.createClient)();
        const { data: { user } } = yield supabase.auth.getUser();
        const admin = yield (0, server_1.createAdminClient)();
        const { data, error } = yield admin
            .from("valoraciones")
            .insert(Object.assign(Object.assign({}, input), { creada_por: (_a = user === null || user === void 0 ? void 0 : user.id) !== null && _a !== void 0 ? _a : null }))
            .select("*, autor:perfiles!valoraciones_creada_por_fkey(nombre, apellidos)")
            .single();
        if (error)
            return { error: error.message };
        (0, cache_1.revalidatePath)("/valorador");
        const row = data;
        const valoracion = Object.assign(Object.assign({}, row), { autor: Array.isArray(row.autor) ? ((_b = row.autor[0]) !== null && _b !== void 0 ? _b : null) : ((_c = row.autor) !== null && _c !== void 0 ? _c : null) });
        return { valoracion };
    });
}
function eliminarValoracion(id) {
    return __awaiter(this, void 0, void 0, function* () {
        const supabase = yield (0, server_1.createAdminClient)();
        const { error } = yield supabase.from("valoraciones").delete().eq("id", id);
        if (error)
            return { error: error.message };
        (0, cache_1.revalidatePath)("/valorador");
        return { success: true };
    });
}
