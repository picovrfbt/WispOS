// Starts a new add-on from one of the templates.
//
//   node new.mjs <id> [--template blank|gauge|list|tiles|ambient] [--name "My add-on"] [--author "Your name"]
//
// It copies templates/<template> to ./<id>, fills in addon.json, and tells
// you what's next. The templates:
//
//   blank    the least an add-on needs: the knob, a press, saving a value
//   gauge    one big number, a bar and three small ones (your speed)
//   list     rows the knob scrolls, the one under it shown in full
//   tiles    a dashboard: weather, the song, the time, a site's data
//   ambient  slow colour and the song that's playing

import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const TEMPLATES = join(HERE, 'templates')
const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const valued = new Set(['--template', '--name', '--author'])
const id = args.find((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]))
const template = opt('--template') ?? 'blank'
const names = readdirSync(TEMPLATES, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)

if (!id) {
  console.error(`usage: node new.mjs <id> [--template ${names.join('|')}] [--name "My add-on"] [--author "Your name"]`)
  process.exit(2)
}
if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(id)) {
  console.error('The id is lowercase letters, digits and dashes, 2 to 40 of them: "trip-stats", not "Trip Stats"')
  process.exit(2)
}
if (!names.includes(template)) {
  console.error(`No template "${template}". There are: ${names.join(', ')}`)
  process.exit(2)
}
const dest = join(HERE, id)
if (existsSync(dest)) {
  console.error(`addons/${id} is already there`)
  process.exit(1)
}

cpSync(join(TEMPLATES, template), dest, { recursive: true })
// its own picture comes later, from preview.mjs or your own
rmSync(join(dest, 'preview.png'), { force: true })

const m = JSON.parse(readFileSync(join(dest, 'addon.json'), 'utf8'))
m.id = id
m.name = opt('--name') ?? id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())
m.author = opt('--author') ?? m.author
m.version = '1.0.0'
writeFileSync(join(dest, 'addon.json'), JSON.stringify(m, null, 2) + '\n')
const page = join(dest, m.entry || 'index.html')
writeFileSync(page, readFileSync(page, 'utf8').replace(/<title>[^<]*<\/title>/, `<title>${m.name.replace(/[<&]/g, '')}</title>`))

console.log(`Made addons/${id} from the "${template}" template.

Next:
  1. Edit addons/${id}/addon.json: the name, your name, one line on what it does,
     and only the permissions and sites it uses.
  2. Try it as you edit:   node preview.mjs ${id} --serve
  3. Take its picture:     node preview.mjs ${id}
  4. Pack it:              python pack.py
  5. Open a pull request with addons/${id}, dist/ and catalog.json.

The guide: https://picovrfbt.github.io/WispOS/addons.html`)
