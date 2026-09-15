import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Orígenes permitidos EN DESARROLLO.
   *
   * Next bloquea las peticiones internas (los trozos de React, la recarga en
   * caliente) cuando la página se abre desde un host que no ha autorizado. El
   * síntoma es traicionero: la página se pinta entera y parece funcionar, pero
   * React no llega a engancharse y NINGÚN botón responde. Se ve como si la
   * aplicación estuviera rota, y lo que está roto es el permiso.
   *
   * Hace falta para poder tener DOS SESIONES ABIERTAS A LA VEZ —un
   * administrador y un agente— y ver las dos pantallas en paralelo. No vale con
   * cambiar de puerto: el navegador no separa las cookies por puerto, sólo por
   * nombre de host. Así que el administrador entra por `localhost:3000` y el
   * agente por `127.0.0.1:3000`, que para el navegador son dos sitios distintos
   * y cada uno guarda su sesión.
   *
   * Esto NO afecta a producción: `allowedDevOrigins` sólo lo lee `next dev`.
   */
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
