import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import browserslist from 'browserslist'
import { browserslistToTargets, transform } from 'lightningcss'

const ASSETS_DIR = 'dist/assets'
const TARGET_BROWSERS = [
  'Chrome >= 61',
  'Edge >= 79',
  'Firefox >= 68',
  'Safari >= 12'
]

const unwrapAtLayer = (css) => {
  let output = ''
  let index = 0

  while (index < css.length) {
    const layerIndex = css.indexOf('@layer', index)

    if (layerIndex === -1) {
      output += css.slice(index)
      break
    }

    output += css.slice(index, layerIndex)

    const openBraceIndex = css.indexOf('{', layerIndex)
    const semicolonIndex = css.indexOf(';', layerIndex)

    if (semicolonIndex !== -1 && (openBraceIndex === -1 || semicolonIndex < openBraceIndex)) {
      index = semicolonIndex + 1
      continue
    }

    if (openBraceIndex === -1) {
      output += css.slice(layerIndex)
      break
    }

    let depth = 1
    let cursor = openBraceIndex + 1

    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth += 1
      if (css[cursor] === '}') depth -= 1
      cursor += 1
    }

    output += css.slice(openBraceIndex + 1, cursor - 1)
    index = cursor
  }

  return output
}

const cssFiles = (await readdir(ASSETS_DIR)).filter(file => file.endsWith('.css'))

for (const file of cssFiles) {
  const filePath = join(ASSETS_DIR, file)
  const source = await readFile(filePath)
  const transformed = transform({
    filename: file,
    code: source,
    minify: true,
    targets: browserslistToTargets(browserslist(TARGET_BROWSERS))
  }).code.toString()
  const compatibleCss = unwrapAtLayer(transformed)

  await writeFile(filePath, compatibleCss)
  console.log(`Compat CSS: ${file}`)
}
