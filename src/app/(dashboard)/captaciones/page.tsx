import { getCaptaciones, getCaptacionesEliminadas, getCaptacionesEliminadasPorAgente, getAgentes, getTotalesCaptaciones } from "@/lib/actions/captaciones"
import { getAutoContactoConfig, getEstadoCola } from "@/lib/actions/captaciones-config"
import { CaptacionesList } from "@/components/captaciones/captaciones-list"
import { CaptacionesConfig } from "@/components/captaciones/captaciones-config"
import { exigirModulo } from "@/lib/auth/acceso"
// Para comprobar que la captación que pide la URL es de quien la pide: el
// cliente del usuario, no el de servicio, que ése se salta RLS por definición.
import { createClient } from "@/lib/supabase/server"
import { getEstadoAsignacion } from "@/lib/actions/asignacion"
import { getCatalogosActivos } from "@/lib/actions/catalogos"

export const metadata = { title: "Captaciones — mkgenia" }

/**
 * Cómo se lee el periodo con el que venía la portada.
 *
 * Las mismas palabras que sus botones, porque se acaba de pulsar uno: si allí
 * ponía "7 días" y aquí pusiera otra cosa, parecería otro filtro.
 */
const ETIQUETA_PERIODO: Record<string, string> = {
  hoy: "hoy",
  semana: "en los últimos 7 días",
  mes: "en los últimos 30 días",
}

/**
 * LAS DOS PREGUNTAS QUE PUEDE TRAER `?fecha=`, y lo que cada una dice en la chapa.
 *
 * Las dos tarjetas del scraper NO CUENTAN LO MISMO, así que no basta con un
 * `?desde=` como el de /leads: hace falta saber CONTRA QUÉ se compara.
 *
 *   · `entrada` — la tarjeta del AGENTE, que son sus captaciones asignadas y se
 *     fechan por cuándo entró el anuncio (`created_at`).
 *   · `senal`   — la tarjeta del ADMINISTRADOR, que no cuenta anuncios sino
 *     propietarios que dijeron que sí, fechados por cuándo lo dijeron
 *     (`senal_en`).
 *
 * Y por eso la chapa dice una cosa distinta en cada caso: "entradas en los
 * últimos 7 días" y "se interesaron en los últimos 7 días" son dos listas
 * distintas —hoy 98 y 13— y quien mira la pantalla tiene que saber cuál está
 * viendo.
 *
 * La URL nombra la PREGUNTA y no la columna a propósito: lo que se escribe en
 * la barra del navegador no tiene por qué saber cómo se llaman las columnas de
 * la tabla, y así un `?fecha=` inventado no llega ni a parecerse a una.
 */
const FILTROS_FECHA: Record<string, { campo: "created_at" | "senal_en"; frase: string }> = {
  entrada: { campo: "created_at", frase: "Entradas" },
  senal: { campo: "senal_en", frase: "Se interesaron" },
}

/**
 * Para cuando llega un corte sin su palabra: se escribe la fecha.
 *
 * Zona y formato fijos porque este texto se calcula en el SERVIDOR y baja ya
 * escrito: el navegador lo pinta tal cual, así que no hay dos versiones que
 * puedan no coincidir al hidratar.
 */
const FECHA_CORTA = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit", month: "2-digit", timeZone: "Europe/Madrid",
})

export default async function CaptacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; periodo?: string; fecha?: string; desde?: string }>
}) {
  const { userId, isAdmin } = await exigirModulo("captaciones")

  /**
   * LO QUE ESTA PANTALLA ACEPTA POR LA URL, y de dónde viene.
   *
   * Lo escriben LAS DOS portadas: la fila de una captación en "lo que toca hoy"
   * (`?id=`) y las dos tarjetas del scraper (`?fecha=`, `?desde=`, `?periodo=`).
   * Se lee AQUÍ, en el servidor, y baja como prop — con `useSearchParams` habría
   * que envolver media pantalla en un Suspense, y leyendo `window.location` el
   * primer render sería distinto del segundo, que es un desajuste de hidratación.
   *
   *   · `id`      una ficha concreta, la de la fila que se ha pulsado.
   *   · `fecha`   CONTRA QUÉ se compara: si entró el anuncio o si el
   *               propietario se interesó (ver `FILTROS_FECHA`).
   *   · `desde`   el instante en que empieza el periodo que estaba puesto, ya
   *               calculado en la portada con el MISMO corte con el que se contó
   *               el número de la tarjeta. Es lo que evita que la tarjeta diga
   *               13 y aquí salgan 759.
   *   · `periodo` sólo para poder escribir la chapa con palabras.
   *
   * `id` se valida como entero: `captaciones.id` es un número, y lo que llegue
   * escrito a mano en la barra del navegador no puede colarse hasta la consulta.
   */
  const { id, periodo, fecha, desde } = await searchParams
  const idPedido = id && /^\d+$/.test(id) ? Number(id) : null

  /**
   * ARREGLADO EN REVISIÓN: y DE QUIÉN es esa captación.
   *
   * Validar que el id es un entero dice que la URL está bien escrita, no que la
   * ficha sea de quien la pide. La lista se filtra por `agente_id` dentro de
   * `getCaptaciones`, pero la ficha la trae `getCaptacion(id)` por el id a secas
   * y la política de RLS de `captaciones` es `USING (true)` para cualquiera que
   * haya entrado (028): hasta hoy eso no se notaba porque el panel sólo se abría
   * pulsando una tarjeta de la lista, o sea de las tuyas. Aceptando el id por la
   * URL, cambiar un número en la barra del navegador abría la ficha completa de
   * la captación de un compañero —con su propietario, su teléfono y sus notas—.
   *
   * Se comprueba con una consulta por clave primaria y sólo cuando se llega con
   * `?id=`: el que entra a /captaciones a secas no paga nada. Y si no es suya no
   * se redirige ni se enseña un error: la lista sale entera, que es lo que había
   * pedido la URL además de la ficha.
   */
  let capInicial: number | null = null
  if (idPedido !== null) {
    if (isAdmin) {
      capInicial = idPedido
    } else {
      const supabase = await createClient()
      const { data: propia } = await supabase
        .from("captaciones")
        .select("id")
        .eq("id", idPedido)
        .eq("agente_id", userId)
        .maybeSingle()
      capInicial = propia ? idPedido : null
    }
  }

  /**
   * Y EL CORTE DE FECHA, que es lo que esta pantalla SÍ hace desde hoy.
   *
   * Aquí había un cartel de texto avisando de que esta lista no se filtraba por
   * fecha. El dueño no quería el cartel, quería el filtro: pulsar una tarjeta
   * que dice 13 tiene que enseñar esas 13, y volver a verlas todas es quitar la
   * chapa. Así que el aviso se va y en su sitio queda el corte de verdad.
   *
   * Las dos mitades se validan por separado y hacen falta LAS DOS:
   *
   *   · La pregunta, contra `FILTROS_FECHA` y con `Object.hasOwn`, no leyendo la
   *     clave a pelo: `FILTROS_FECHA["toString"]` no vale undefined, vale la
   *     función heredada del prototipo, y con `?fecha=toString` esa función
   *     llegaría hasta el `.campo` de la consulta.
   *   · La fecha, normalizada a ISO en vez de pasar el texto tal cual: así lo
   *     que viaja a la consulta es siempre algo que Postgres entiende.
   *
   * Y lo que no cuadra NO filtra: sale la lista entera, que es menos malo que
   * una pantalla vacía sin explicación o que un 400 de PostgREST disfrazado de
   * "no tienes captaciones". `getCaptaciones` lo vuelve a comprobar por su
   * cuenta —es una acción que puede llamar el navegador—, pero aquí hay que
   * saberlo igual para escribir la chapa.
   */
  const filtroFecha = fecha && Object.hasOwn(FILTROS_FECHA, fecha) ? FILTROS_FECHA[fecha] : null
  const ms = desde ? new Date(desde).getTime() : NaN

  // La palabra del periodo, con `Object.hasOwn` por lo mismo que la de arriba:
  // `ETIQUETA_PERIODO["toString"]` no vale undefined, vale la función heredada
  // del prototipo, y con `?periodo=toString` se colaría dentro de la frase de la
  // chapa como si fuera texto. Cuando no hay palabra que valga la chapa escribe
  // la fecha, que dice lo mismo y nunca falta.
  const palabraPeriodo =
    periodo && Object.hasOwn(ETIQUETA_PERIODO, periodo) ? ETIQUETA_PERIODO[periodo] : ""

  const corte = filtroFecha && !Number.isNaN(ms)
    ? { campo: filtroFecha.campo, desde: new Date(ms).toISOString() }
    : null

  // "Se interesaron en los últimos 7 días" / "Entradas desde el 09/09". La frase
  // entera se escribe en el servidor: el navegador la pinta tal cual y no hay
  // dos versiones que puedan no coincidir al hidratar.
  const etiquetaFecha = corte && filtroFecha
    ? `${filtroFecha.frase} ${palabraPeriodo || `desde el ${FECHA_CORTA.format(ms)}`}`
    : ""

  const [primeraPagina, eliminadas, config, agentes, cola, reparto, totales, catalogos] = await Promise.all([
    // Sólo la primera página: el resto las pide la lista al cambiar de página o
    // de filtro. getCaptaciones resuelve por su cuenta quién eres, así que ya no
    // hay que pasarle el rol ni el id del agente.
    getCaptaciones(corte ? { corte } : {}),
    isAdmin ? getCaptacionesEliminadas() : getCaptacionesEliminadasPorAgente(userId),
    isAdmin ? getAutoContactoConfig() : null,
    isAdmin ? getAgentes() : [],
    isAdmin ? getEstadoCola() : { enCola: 0, enviadasHoy: 0 },
    // Sólo el administrador ve el panel de reparto, así que sólo para él se pide.
    isAdmin ? getEstadoAsignacion() : null,
    // Con el MISMO corte que la lista: si la cabecera y las pastillas contaran
    // la tabla entera mientras la lista enseña trece fichas, la pantalla se
    // contradiría sola.
    getTotalesCaptaciones(corte ? { corte } : {}),
    // De aquí salen las pastillas de la lista: nombre, color y orden de cada
    // estado, tal y como estén en /configuracion/catalogos.
    getCatalogosActivos(),
  ])

  // De la base de datos y no de la lista: la lista sólo trae la página que se
  // ve, y contar sobre ella daría 50 pase lo que pase.
  const { total, porEstado: totalesEstado, porSenal: totalesSenal, conSenal } = totales

  // Los interesados ya no se suman aquí. Hasta la 027 eran dos estados
  // (`Interesado` + `Quiere_Llamada`) y había que sumarlos a mano; ahora son una
  // columna propia, `senal`, y el número lo cuenta la base de datos de una vez.
  // Si ese contador falló llega como null y el subtítulo se queda sin la
  // coletilla, que es mejor que enseñar un 0 que se lee como "no hay ninguno".
  const interesados = conSenal

  return (
    // El hueco entre la cabecera y la lista lo pone el `gap` de aquí, no un
    // `mb-` en la cabecera: el hijo no tiene por qué saber qué lleva debajo.
    // Los overlays de la lista (ficha y diálogos) son `fixed`, así que quedan
    // fuera del flujo y el `gap` no les afecta.
    <div className="p-8 flex flex-col gap-8">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">
            {isAdmin ? "Captaciones" : "Mis captaciones"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {/* Interesados = los que tienen señal, sea "Le interesa" o "Quiere
                llamada": en los dos casos es un propietario que ha dicho que sí
                y espera una llamada. Es el mismo criterio con el que reparte el
                trigger y con el que cuenta la tarjeta del scraper en la
                portada, para que los tres sitios digan siempre lo mismo. */}
            {total.toLocaleString("es")} {isAdmin ? "propiedades" : "captaciones asignadas"}
            {interesados !== null && ` · ${interesados.toLocaleString("es")} interesados`}
          </p>
        </div>
        {isAdmin && config && reparto && (
          <CaptacionesConfig
            enabled={config.enabled}
            zonas={config.zonas}
            limiteDiario={config.limiteDiario}
            ritmo={config.ritmo}
            uso={config.uso}
            cola={cola}
            avisos={config.avisos}
            reparto={reparto}
          />
        )}
      </div>

      <CaptacionesList
        // LA CLAVE CAMBIA CON EL CORTE, y hace falta.
        //
        // La chapa se suelta volviendo a /captaciones sin parámetros, o sea una
        // navegación: el servidor vuelve a contar y bajan unas props nuevas.
        // Pero la lista guarda sus filas en estado —las pide ella al paginar—,
        // así que sin cambiar la clave React reusaría la misma instancia y se
        // quedarían en pantalla las trece viejas mientras la cabecera dice 759.
        // Con la clave se monta de cero y todo lo que se ve sale de la misma
        // consulta.
        key={corte ? `${corte.campo}:${corte.desde}` : "sin-corte"}
        initialData={primeraPagina.filas}
        initialTotal={primeraPagina.total}
        eliminadas={eliminadas}
        total={total}
        totalesEstado={totalesEstado}
        totalesSenal={totalesSenal}
        catalogos={catalogos}
        isAdmin={isAdmin}
        agentes={agentes}
        // La ficha que hay que abrir al entrar, si se viene de pulsar una fila
        // de "lo que toca hoy". La ficha se trae sola de la base por su id, así
        // que da igual que esa captación no esté en la primera página.
        capInicial={capInicial}
        // El corte ya validado, para que la lista lo siga llevando cuando pida
        // otra página o cambie de pastilla: si no, pasar a la página 2 devolvería
        // las 759 y el filtro se habría evaporado a la primera.
        corteFecha={corte}
        // Y la frase de la chapa, escrita arriba. Va aparte del corte porque el
        // corte es lo que se consulta y esto es lo que se lee: "se interesaron en
        // los últimos 7 días" no es lo mismo que "entradas en los últimos 7
        // días", y quien mira tiene que saber cuál de las dos está viendo.
        etiquetaFecha={etiquetaFecha}
      />
    </div>
  )
}
