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
 * Cómo se lee el periodo con el que venía la portada del agente.
 *
 * Las mismas palabras que sus botones, porque el agente acaba de pulsar uno: si
 * allí ponía "7 días" y aquí pusiera otra cosa, parecería otro filtro.
 */
const ETIQUETA_PERIODO: Record<string, string> = {
  hoy: "hoy",
  semana: "los últimos 7 días",
  mes: "los últimos 30 días",
}

export default async function CaptacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; periodo?: string }>
}) {
  const { userId, isAdmin } = await exigirModulo("captaciones")

  /**
   * LO QUE ESTA PANTALLA ACEPTA POR LA URL, y de dónde viene.
   *
   * Lo escribe la portada del agente: la fila de una captación en "lo que toca
   * hoy" (`?id=`) y la tarjeta del scraper (`?periodo=`). Se lee AQUÍ, en el
   * servidor, y baja como prop — con `useSearchParams` habría que envolver media
   * pantalla en un Suspense, y leyendo `window.location` el primer render sería
   * distinto del segundo, que es un desajuste de hidratación.
   *
   * `id` se valida como entero: `captaciones.id` es un número, y lo que llegue
   * escrito a mano en la barra del navegador no puede colarse hasta la consulta.
   */
  const { id, periodo } = await searchParams
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
   * Y EL AVISO DEL PERIODO, que es lo que esta pantalla no puede hacer.
   *
   * La tarjeta del scraper enseña las captaciones del periodo que el agente
   * tenga puesto, pero esta lista la trae `getCaptaciones` con tres filtros
   * —pastilla, búsqueda y página— y ninguno es la fecha, así que aquí salen
   * todas. Un número que promete tres y una lista de 759 sin explicación es
   * exactamente lo que no vale, así que se dice con palabras en la cabecera: es
   * media línea de texto contra reescribir la consulta de la lista.
   */
  //
  // ARREGLADO EN REVISIÓN: la clave se busca con `Object.hasOwn` y no leyéndola
  // a pelo. `ETIQUETA_PERIODO["toString"]` no vale undefined: vale la función
  // heredada del prototipo, y con `?periodo=toString` esa función bajaba hasta
  // el `<p>` de aquí abajo. React no pinta una función como hijo: deja el hueco
  // y avisa por consola, o sea una frase a medias en mitad de la cabecera.
  const avisoPeriodo =
    periodo && Object.hasOwn(ETIQUETA_PERIODO, periodo) ? ETIQUETA_PERIODO[periodo] : null

  const [primeraPagina, eliminadas, config, agentes, cola, reparto, totales, catalogos] = await Promise.all([
    // Sólo la primera página: el resto las pide la lista al cambiar de página o
    // de filtro. getCaptaciones resuelve por su cuenta quién eres, así que ya no
    // hay que pasarle el rol ni el id del agente.
    getCaptaciones(),
    isAdmin ? getCaptacionesEliminadas() : getCaptacionesEliminadasPorAgente(userId),
    isAdmin ? getAutoContactoConfig() : null,
    isAdmin ? getAgentes() : [],
    isAdmin ? getEstadoCola() : { enCola: 0, enviadasHoy: 0 },
    // Sólo el administrador ve el panel de reparto, así que sólo para él se pide.
    isAdmin ? getEstadoAsignacion() : null,
    getTotalesCaptaciones(),
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
          {/* Vienes de pulsar una tarjeta que contaba un periodo; aquí no hay
              filtro de fecha y se dice, en vez de dejar que el número de arriba
              contradiga al que acabas de pulsar. */}
          {avisoPeriodo && (
            <p className="text-xs text-muted-foreground">
              Vienes de tu portada mirando {avisoPeriodo}. Esta lista no se filtra por fecha:
              aquí salen todas tus captaciones.
            </p>
          )}
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
      />
    </div>
  )
}
