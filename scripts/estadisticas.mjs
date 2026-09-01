/**
 * Genera las tarjetas de estadísticas del perfil.
 *
 * Por qué existe esto en vez de un `<img src="…vercel.app/api?username=…">`:
 * ese servicio se cae. Consulta la API de GitHub sin token y, en cuanto se
 * agota la cuota compartida -que se agota todos los días-, devuelve una
 * tarjeta que dice "Something went wrong". El perfil aparece roto y uno se
 * entera cuando alguien se lo dice.
 *
 * Aquí los datos se piden una vez al día desde una Action, con el
 * `GITHUB_TOKEN` que la propia Action ya trae, y el resultado se guarda como
 * un SVG dentro del repositorio. El README apunta a un archivo suyo, servido
 * por el CDN de GitHub: no hay servicio de terceros que se pueda caer, ni
 * cuota que se pueda agotar, ni token que caduque.
 *
 * Uso: node scripts/estadisticas.mjs
 * Necesita GITHUB_TOKEN (o GH_TOKEN) en el entorno.
 */

import { writeFile, mkdir } from 'node:fs/promises'

const USUARIO = process.env.USUARIO_GITHUB || 'revkelo'
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
if (!TOKEN) {
  console.error('Falta GITHUB_TOKEN en el entorno.')
  process.exit(1)
}

/* La paleta del perfil: el naranja es el mismo de kgstudio.top */
const T = {
  fondo: '#0d1117',
  borde: '#20262e',
  titulo: '#f56f0d',
  texto: '#c9d1d9',
  tenue: '#7d8590',
  cifra: '#f0f6fc',
}

const CONSULTA = `
query ($usuario: String!) {
  user(login: $usuario) {
    name
    followers { totalCount }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      contributionCalendar { totalContributions }
    }
    pullRequests(states: MERGED) { totalCount }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 12, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`

async function pedirDatos() {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'revkelo-perfil',
    },
    body: JSON.stringify({ query: CONSULTA, variables: { usuario: USUARIO } }),
  })
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}`)
  const json = await res.json()
  if (json.errors) throw new Error(json.errors.map((e) => e.message).join('; '))
  return json.data.user
}

/** Escapa lo que va dentro del SVG: un nombre puede traer & o < */
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])

const miles = (n) => new Intl.NumberFormat('en-US').format(n)

/*
 * Las dos tarjetas comparten marco, tipografía y animación de entrada. Se
 * escriben aquí y no se importan de ningún lado: son 40 líneas y una
 * dependencia menos que mantener.
 */
function marco({ ancho, alto, titulo, cuerpo }) {
  return `<svg width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}" fill="none"
     xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="titulo">
  <title id="titulo">${esc(titulo)}</title>
  <style>
    .titulo { font: 600 18px 'Segoe UI', Ubuntu, sans-serif; fill: ${T.titulo} }
    .clave  { font: 400 14px 'Segoe UI', Ubuntu, sans-serif; fill: ${T.texto} }
    .cifra  { font: 700 15px 'Segoe UI', Ubuntu, sans-serif; fill: ${T.cifra} }
    .tenue  { font: 400 11px 'Segoe UI', Ubuntu, sans-serif; fill: ${T.tenue} }
    .rotulo { font: 600 10px 'Segoe UI', Ubuntu, sans-serif; fill: ${T.tenue}; letter-spacing: 1.2px }
    /* Entrada escalonada. Quien pida menos movimiento la ve ya puesta */
    .fila { opacity: 0; animation: entrar .5s ease forwards }
    @keyframes entrar { to { opacity: 1 } }
    @media (prefers-reduced-motion: reduce) {
      .fila { opacity: 1; animation: none }
    }
  </style>
  <rect x="0.5" y="0.5" width="${ancho - 1}" height="${alto - 1}" rx="10"
        fill="${T.fondo}" stroke="${T.borde}" />
  <text x="25" y="35" class="titulo">${esc(titulo)}</text>
  ${cuerpo}
</svg>`
}

function tarjetaResumen(u) {
  const c = u.contributionsCollection
  const estrellas = u.repositories.nodes.reduce((a, r) => a + r.stargazerCount, 0)

  /*
   * Dos bloques, y no una lista sola, porque los números no miden lo mismo.
   * `contributionsCollection` es del último año; los repositorios, las
   * estrellas y los PRs fusionados son de siempre. Juntos y sin rotular daban
   * una tarjeta que se contradecía sola: 21 pull requests encima de 133
   * fusionados, que es imposible de leer sin pensar que algo está roto.
   */
  const grupos = [
    ['Último año', [
      ['Contribuciones', c.contributionCalendar.totalContributions],
      ['Commits', c.totalCommitContributions],
      ['Pull requests', c.totalPullRequestContributions],
      ['Issues', c.totalIssueContributions],
    ]],
    ['En total', [
      ['Repositorios propios', u.repositories.totalCount],
      ['Pull requests fusionados', u.pullRequests.totalCount],
      ['Estrellas recibidas', estrellas],
      ['Seguidores', u.followers.totalCount],
    ]],
  ]

  let y = 66
  let n = 0
  const partes = []
  for (const [rotulo, filas] of grupos) {
    partes.push(`
  <text x="25" y="${y}" class="rotulo">${esc(rotulo.toUpperCase())}</text>`)
    y += 20
    for (const [clave, valor] of filas) {
      partes.push(`
  <g class="fila" style="animation-delay: ${n * 60}ms">
    <text x="25" y="${y}" class="clave">${esc(clave)}</text>
    <text x="375" y="${y}" class="cifra" text-anchor="end">${miles(valor)}</text>
  </g>`)
      y += 26
      n += 1
    }
    y += 12
  }

  return marco({ ancho: 400, alto: y + 4, titulo: `Actividad de ${USUARIO}`, cuerpo: partes.join('') })
}

function tarjetaLenguajes(u) {
  /*
   * Se suman los bytes de todos los repositorios propios, no se cuenta un
   * repositorio por lenguaje: un proyecto grande y uno de una tarde no pesan
   * lo mismo, y contarlos igual da un gráfico que no se parece a nada.
   */
  const bytes = new Map()
  for (const repo of u.repositories.nodes) {
    for (const { size, node } of repo.languages.edges) {
      const previo = bytes.get(node.name) ?? { total: 0, color: node.color || T.tenue }
      previo.total += size
      bytes.set(node.name, previo)
    }
  }

  const total = [...bytes.values()].reduce((a, v) => a + v.total, 0) || 1
  const top = [...bytes.entries()]
    .map(([nombre, v]) => ({ nombre, ...v, pct: (v.total / total) * 100 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)

  // La barra apilada: el reparto de una ojeada
  let x = 25
  const barra = top
    .map((l) => {
      const ancho = (l.pct / 100) * 350
      const trozo = `<rect x="${x.toFixed(1)}" y="52" width="${Math.max(ancho, 1).toFixed(1)}" height="10" fill="${l.color}" />`
      x += ancho
      return trozo
    })
    .join('')

  const leyenda = top
    .map((l, i) => {
      const col = i % 2
      const fila = Math.floor(i / 2)
      const cx = 25 + col * 185
      const cy = 88 + fila * 24
      return `
  <g class="fila" style="animation-delay: ${i * 70}ms">
    <circle cx="${cx + 5}" cy="${cy - 4}" r="5" fill="${l.color}" />
    <text x="${cx + 18}" y="${cy}" class="clave">${esc(l.nombre)}</text>
    <text x="${cx + 160}" y="${cy}" class="tenue" text-anchor="end">${l.pct.toFixed(1)}%</text>
  </g>`
    })
    .join('')

  const alto = 100 + Math.ceil(top.length / 2) * 24
  return marco({
    ancho: 400,
    alto,
    titulo: 'Lenguajes más usados',
    cuerpo: `<g>${barra}</g>${leyenda}
  <text x="25" y="${alto - 12}" class="tenue">Por bytes de código en ${u.repositories.totalCount} repositorios propios</text>`,
  })
}

const usuario = await pedirDatos()
await mkdir('img', { recursive: true })
await writeFile('img/stats.svg', tarjetaResumen(usuario), 'utf8')
await writeFile('img/langs.svg', tarjetaLenguajes(usuario), 'utf8')
console.log('Tarjetas escritas en img/stats.svg e img/langs.svg')
