/**
 * Traer una consulta entera, saltándose el tope de PostgREST.
 *
 * Supabase expone la base de datos por PostgREST, que trae un ajuste `max-rows`
 * con 1.000 por defecto. No es negociable desde el cliente: pedir `limit(5000)`
 * no sirve, el servidor recorta igual.
 *
 * Lo peligroso es cómo recorta: devuelve `200 OK` con mil filas, sin error, sin
 * aviso y sin nada que mirar. Y si la consulta no lleva `ORDER BY`, las mil que
 * devuelve son las que Postgres tenga más a mano — en la práctica, las más
 * antiguas.
 *
 * Eso tuvo a la portada del CRM calculando sus tarjetas sobre datos congelados
 * el 11/09/2026 durante días: los leads recientes sencillamente no existían para
 * esa pantalla, y el hueco crecía cada día. Con 200 leads diarios se vuelve a
 * cruzar el tope en menos de una semana, así que no es algo que se arregle una
 * vez: hay que contar con ello siempre que se lea una tabla que crece.
 *
 * Cuándo NO usar esto: si sólo necesitas números, cuenta en la base de datos con
 * un `GROUP BY` en una función (como `uso_catalogos()`), que devuelve veinte
 * filas en vez de tres mil. Esto es para cuando de verdad hacen falta las filas.
 */

const PAGINA = 1000
/** Si una tabla llega aquí, el problema ya no es el tope sino la consulta. */
const TECHO = 50_000

type ConRange<T> = {
  range: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>
}

/**
 * @param hacerConsulta Devuelve la consulta YA construida (filtros, orden,
 *   select) pero SIN `range`. Se llama una vez por página porque los
 *   constructores de supabase-js no se pueden reutilizar tras ejecutarse.
 */
export async function traerTodo<T>(hacerConsulta: () => ConRange<T>): Promise<T[]> {
  const todo: T[] = []

  for (let desde = 0; desde < TECHO; desde += PAGINA) {
    const { data, error } = await hacerConsulta().range(desde, desde + PAGINA - 1)

    // Si una página falla se devuelve lo que haya en vez de lanzar: media
    // portada es mejor que una pantalla de error, y el hueco se nota.
    if (error || !data?.length) break

    todo.push(...data)
    if (data.length < PAGINA) break
  }

  return todo
}
