// ============================================================================
// Arranca una copia del CRM contra el SANDBOX (proyecto Supabase crm-sandbox),
// en el puerto 3107 y con el cortafuegos de salida puesto.
//
// Para qué. El equipo de testeo simula una inmobiliaria usando el CRM. Esa
// prueba no puede tocar producción ni mandar nada al mundo real, así que:
//   · la configuración sale de `.env.sandbox`, no de `.env.local`;
//   · el cortafuegos (`sandbox-cortafuegos.cjs`) sólo deja salir hacia el
//     sandbox y un par de APIs públicas del valorador. Hace falta aunque las
//     variables estén vacías, porque la URL y las claves de Evolution (WhatsApp)
//     están escritas dentro del código del CRM;
//   · usa su propia carpeta de compilación (`.next-sandbox`), para poder correr
//     a la vez que el CRM normal sin pisarse.
//
// Uso:  node scripts/sandbox-dev.cjs
// ============================================================================
"use strict"

const fs = require("fs")
const path = require("path")
const { spawn } = require("child_process")

const RAIZ = path.resolve(__dirname, "..")
const ENV = path.join(RAIZ, ".env.sandbox")
const PUERTO = process.env.SANDBOX_PORT || "3107"
const SANDBOX_HOST = "gxnwtxvcyosccbofpcjb.supabase.co"

if (!fs.existsSync(ENV)) {
  console.error("Falta .env.sandbox. Sin él no se sabe contra qué base de datos arrancar.")
  process.exit(1)
}

// Un .env sencillo: CLAVE=valor, sin comillas ni expansiones.
const vars = {}
for (const linea of fs.readFileSync(ENV, "utf8").split(/\r?\n/)) {
  const m = linea.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
  if (!m || linea.trim().startsWith("#")) continue
  vars[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
}

// Guardas: que no haya forma de arrancar esto apuntando a producción.
const url = vars.NEXT_PUBLIC_SUPABASE_URL || ""
if (!url.includes(SANDBOX_HOST)) {
  console.error(`.env.sandbox no apunta al sandbox (${SANDBOX_HOST}), sino a: ${url || "(vacío)"}`)
  process.exit(1)
}
for (const clave of ["EVO_API_URL", "EVO_API_KEY", "EVO_INSTANCE", "APIFY_TOKEN", "WEBHOOK_SECRET"]) {
  if (vars[clave]) {
    console.error(`.env.sandbox trae ${clave} con valor. En la copia de pruebas va vacío.`)
    process.exit(1)
  }
  vars[clave] = ""
}
if (!vars.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("Aviso: SUPABASE_SERVICE_ROLE_KEY vacía. El CRM arranca, pero lo que la use fallará.")
}

// Lo que ya está en process.env manda sobre los .env, así que esto también
// anula lo que traiga .env.local (que apunta a producción).
const entorno = Object.assign({}, process.env, vars, {
  NEXT_DIST_DIR: ".next-sandbox",
  // La ruta va entre comillas: "Grupo Hogares" lleva un espacio y sin ellas
  // Node intenta cargar el módulo "C:\Users\Grupo".
  NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require "${path.join(__dirname, "sandbox-cortafuegos.cjs").replace(/\\/g, "/")}"`]
    .filter(Boolean).join(" "),
})

console.log(`CRM de pruebas → ${url}  ·  http://localhost:${PUERTO}`)

const hijo = spawn(process.execPath, [path.join(RAIZ, "node_modules", "next", "dist", "bin", "next"), "dev", "--port", PUERTO],
  { cwd: RAIZ, env: entorno, stdio: "inherit" })
hijo.on("exit", (codigo) => process.exit(codigo == null ? 1 : codigo))
