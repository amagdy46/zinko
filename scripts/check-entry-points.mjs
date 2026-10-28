// Static check run by `pnpm check` before the linter: every server function and Worker route is
// classified, and nothing outside the approved files runs an Effect directly.
//
// It parses source text with the TypeScript compiler API (syntax only: no type checker, no module
// is imported or executed) and fails closed: syntax it cannot classify is an error, never a pass.
// The contract is in docs/plans/2026-10-28-m6-compare/plan.md (Task 15); how to register a new
// server function or route is in AGENTS.md ("Entry points").
import { readdirSync } from "node:fs"
import { dirname, join, relative, resolve as resolvePath } from "node:path"
import { fileURLToPath } from "node:url"
import { SyntaxKind as K } from "typescript/unstable/ast"
import { API } from "typescript/unstable/sync"

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "..")
const webDir = join(root, "apps/web")
const srcDir = join(webDir, "src")
const serverDir = join(srcDir, "server")
const failures = []

const slash = (path) => path.split("\\").join("/")
const rel = (file) => slash(relative(root, file))

const listSources = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return listSources(path)
    const wanted = /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")
    return wanted && entry.name !== "routeTree.gen.ts" ? [path] : []
  })

const walk = (node, visit) => {
  visit(node)
  node.forEachChild((child) => {
    walk(child, visit)
  })
}

const where = (node) => {
  const sf = node.getSourceFile()
  return `${rel(sf.fileName)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`
}
const fail = (node, message) => failures.push(`${where(node)}: ${message}`)
const failFile = (file, message) => failures.push(`${rel(file)}: ${message}`)

const unwrap = (node) => {
  let current = node
  while (
    current.kind === K.ParenthesizedExpression ||
    current.kind === K.AsExpression ||
    current.kind === K.SatisfiesExpression ||
    current.kind === K.NonNullExpression
  )
    current = current.expression
  return current
}

const isStringLike = (node) =>
  node.kind === K.StringLiteral || node.kind === K.NoSubstitutionTemplateLiteral
const exported = (statement) =>
  statement.modifiers?.some((modifier) => modifier.kind === K.ExportKeyword) === true
const RUN_FUNCTION = /^run(Promise|Sync|Fork|Callback)/

// ---------------------------------------------------------------------------------------------
// Names resolved through imports and local aliases. A descriptor says what a name stands for.
// ---------------------------------------------------------------------------------------------

const moduleKind = (specifier) => {
  const last = specifier.split("/").at(-1)
  const local = specifier.startsWith(".") || specifier.startsWith("@/")
  if (local && last === "runtime") return "runtime-module"
  if (local && last === "server-fn") return "server-fn-module"
  if (specifier === "effect") return "effect-root"
  if (specifier === "effect/Effect") return "effect-namespace"
  if (specifier === "effect/ManagedRuntime") return "managed-runtime"
  if (specifier.startsWith("@tanstack/") && !specifier.includes("/server")) return "start-module"
  return undefined
}

const memberOf = (descriptor, name) => {
  switch (descriptor) {
    case "runtime-module":
      return name === "runtime" ? "runtime" : undefined
    case "server-fn-module":
      return ["mutation", "read", "respond"].includes(name) ? `gate:${name}` : undefined
    case "effect-root":
      if (name === "Effect") return "effect-namespace"
      return name === "ManagedRuntime" ? "ManagedRuntime" : undefined
    case "effect-namespace":
      return RUN_FUNCTION.test(name) ? "run-function" : undefined
    case "runtime":
      return RUN_FUNCTION.test(name) ? "run-function" : undefined
    case "start-module":
      return name === "createServerFn" ? "createServerFn" : undefined
    default:
      return undefined
  }
}

const importedDescriptor = (module, name) => {
  const kind = moduleKind(module)
  if (kind === undefined) return name === "createServerFn" ? "createServerFn" : undefined
  if (name === "*") return kind === "managed-runtime" ? "ManagedRuntime" : kind
  if (kind === "effect-namespace") return memberOf(kind, name)
  if (kind === "managed-runtime") return name === "make" ? "ManagedRuntime" : undefined
  return memberOf(kind, name) ?? (name === "createServerFn" ? "createServerFn" : undefined)
}

const collectImports = (sf) => {
  const imports = new Map()
  const dynamic = []
  for (const statement of sf.statements) {
    if (statement.kind !== K.ImportDeclaration) continue
    const module = statement.moduleSpecifier.text
    const clause = statement.importClause
    if (clause === undefined) continue
    if (clause.name !== undefined)
      imports.set(clause.name.text, { module, name: "default", clause: statement })
    const bindings = clause.namedBindings
    if (bindings === undefined) continue
    if (bindings.kind === K.NamespaceImport)
      imports.set(bindings.name.text, { module, name: "*", clause: statement })
    else
      for (const element of bindings.elements)
        imports.set(element.name.text, {
          module,
          name: (element.propertyName ?? element.name).text,
          clause: statement,
        })
  }
  walk(sf, (node) => {
    if (node.kind === K.CallExpression && node.expression.kind === K.ImportKeyword)
      dynamic.push(node)
  })
  return { imports, dynamic }
}

const analyze = (sf) => {
  const { imports, dynamic } = collectImports(sf)
  const aliases = new Map()
  for (const [local, { module, name }] of imports) {
    const descriptor = importedDescriptor(module, name)
    if (descriptor !== undefined) aliases.set(local, descriptor)
  }

  const resolve = (expression) => {
    const node = unwrap(expression)
    if (node.kind === K.Identifier) return aliases.get(node.text)
    if (node.kind === K.PropertyAccessExpression) {
      const base = resolve(node.expression)
      return base === undefined ? undefined : memberOf(base, node.name.text)
    }
    if (node.kind === K.ElementAccessExpression) {
      const base = resolve(node.expression)
      if (base === undefined) return undefined
      const key = unwrap(node.argumentExpression)
      if (isStringLike(key)) return memberOf(base, key.text)
      fail(
        node,
        `a computed property of ${base} is unsupported syntax; use a plain \`.name\` access`,
      )
      return undefined
    }
    return undefined
  }

  // Local aliases: `const r = runtime`, `const { runPromise } = runtime`, `r = runtime`.
  for (let changed = true; changed;) {
    changed = false
    const record = (name, descriptor) => {
      if (descriptor !== undefined && aliases.get(name) !== descriptor) {
        aliases.set(name, descriptor)
        changed = true
      }
    }
    walk(sf, (node) => {
      if (node.kind === K.VariableDeclaration && node.initializer !== undefined) {
        if (node.name.kind === K.Identifier) record(node.name.text, resolve(node.initializer))
        else if (node.name.kind === K.ObjectBindingPattern) {
          const base = resolve(node.initializer)
          if (base === undefined) return
          for (const element of node.name.elements) {
            if (element.name?.kind !== K.Identifier || element.dotDotDotToken !== undefined) {
              fail(
                element,
                `destructuring ${base} with a rest or nested pattern is unsupported syntax`,
              )
              continue
            }
            const key = (element.propertyName ?? element.name).text
            record(element.name.text, memberOf(base, key))
          }
        }
      } else if (
        node.kind === K.BinaryExpression &&
        node.operatorToken.kind === K.EqualsToken &&
        node.left.kind === K.Identifier
      )
        record(node.left.text, resolve(node.right))
    })
  }
  return { sf, imports, dynamic, aliases, resolve }
}

/** A reference is an identifier used as a value: not a declaration name, a member name or in an import. */
const isReference = (node) => {
  const parent = node.parent
  if (node.kind !== K.Identifier) return true
  switch (parent.kind) {
    case K.PropertyAccessExpression:
      return parent.name !== node
    case K.PropertyAssignment:
    case K.BindingElement:
    case K.VariableDeclaration:
    case K.Parameter:
    case K.ImportSpecifier:
    case K.ImportClause:
    case K.NamespaceImport:
    case K.ExportSpecifier:
      return (
        parent.name !== node &&
        parent.propertyName !== node &&
        !(parent.kind === K.BindingElement && parent.name === node)
      )
    default:
      return true
  }
}

const insideImport = (node) => {
  for (let current = node; current !== undefined; current = current.parent)
    if (current.kind === K.ImportDeclaration) return true
  return false
}

// ---------------------------------------------------------------------------------------------
// The registry (apps/web/src/server/entry-points.ts), read as data.
// ---------------------------------------------------------------------------------------------

const readLiteral = (initializer, onlyObject) => {
  const node = unwrap(initializer)
  if (onlyObject && node.kind === K.ObjectLiteralExpression) {
    const entries = new Map()
    for (const property of node.properties) {
      const key = property.name
      if (
        property.kind !== K.PropertyAssignment ||
        key === undefined ||
        !(key.kind === K.StringLiteral || key.kind === K.Identifier) ||
        !isStringLike(unwrap(property.initializer))
      )
        return { bad: property }
      entries.set(key.text, unwrap(property.initializer).text)
    }
    return { value: entries }
  }
  if (!onlyObject && node.kind === K.ArrayLiteralExpression) {
    const items = []
    for (const element of node.elements) {
      if (!isStringLike(unwrap(element))) return { bad: element }
      items.push(unwrap(element).text)
    }
    return { value: items }
  }
  return { bad: node }
}

const findConst = (sf, name) => {
  for (const statement of sf.statements)
    if (statement.kind === K.VariableStatement)
      for (const declaration of statement.declarationList.declarations)
        if (declaration.name.kind === K.Identifier && declaration.name.text === name)
          return { statement, declaration }
  return undefined
}

const readRegistry = (sf) => {
  const read = (name, onlyObject, form) => {
    const found = findConst(sf, name)
    if (found?.declaration.initializer === undefined) {
      failFile(sf.fileName, `\`${name}\` is missing; expected ${form}`)
      return undefined
    }
    const { value, bad } = readLiteral(found.declaration.initializer, onlyObject)
    if (value === undefined) {
      fail(bad, `\`${name}\` must be a literal of strings only (${form})`)
      return undefined
    }
    return value
  }
  return {
    entries: read("ENTRY_POINTS", true, '`{ "file.export": "read" | "mutation" }`'),
    allowed: read("RUNTIME_ALLOWED", false, '`["file.ts", ...]`'),
  }
}

// ---------------------------------------------------------------------------------------------
// Server functions
// ---------------------------------------------------------------------------------------------

const GATES = ["mutation", "read", "respond"]

const gatesCalledIn = (analysis, node) => {
  const called = new Set()
  walk(node, (inner) => {
    if (inner.kind !== K.CallExpression) return
    const descriptor = analysis.resolve(inner.expression)
    if (descriptor?.startsWith("gate:")) called.add(descriptor.slice(5))
  })
  return called
}

const serverFunctions = (analysis, relName) => {
  const found = []
  walk(analysis.sf, (node) => {
    if (node.kind !== K.Identifier && node.kind !== K.PropertyAccessExpression) return
    if (node.kind === K.Identifier && !isReference(node)) return
    if (insideImport(node)) return
    const descriptor = analysis.resolve(node)
    if (descriptor?.startsWith("gate:") && node.parent.kind !== K.CallExpression)
      fail(
        node,
        `\`${node.getText()}\` is used as a value; call ${descriptor.slice(5)}(...) directly`,
      )
    if (descriptor !== "createServerFn") return
    if (node.kind === K.Identifier && node.parent.kind === K.PropertyAccessExpression) return
    const supported =
      'an `export const name = createServerFn({ method: "GET" | "POST" })...handler(...)` chain'
    if (node.parent.kind !== K.CallExpression || node.parent.expression !== node) {
      fail(node, `createServerFn is stored or passed on; the supported form is ${supported}`)
      return
    }
    let chain = node.parent
    const methods = []
    while (
      chain.parent.kind === K.PropertyAccessExpression &&
      chain.parent.parent.kind === K.CallExpression &&
      chain.parent.parent.expression === chain.parent
    ) {
      methods.push({ name: chain.parent.name.text, call: chain.parent.parent })
      chain = chain.parent.parent
    }
    const declaration = chain.parent
    const statement = declaration.parent?.parent
    if (
      declaration.kind !== K.VariableDeclaration ||
      declaration.initializer !== chain ||
      declaration.name.kind !== K.Identifier ||
      statement?.kind !== K.VariableStatement ||
      statement.parent.kind !== K.SourceFile ||
      !exported(statement)
    ) {
      fail(
        node,
        `createServerFn is not the initializer of an exported const; the supported form is ${supported}`,
      )
      return
    }
    const options = node.parent.arguments[0] && unwrap(node.parent.arguments[0])
    let method
    if (options?.kind === K.ObjectLiteralExpression)
      for (const property of options.properties)
        if (
          property.kind === K.PropertyAssignment &&
          property.name?.kind === K.Identifier &&
          property.name.text === "method" &&
          isStringLike(unwrap(property.initializer))
        )
          method = unwrap(property.initializer).text
    if (method === undefined) {
      fail(
        node,
        `\`method\` must be a string literal in the first argument: createServerFn({ method: "POST" })`,
      )
      return
    }
    const gates = new Set()
    for (const { name, call } of methods)
      if (name === "handler") for (const gate of gatesCalledIn(analysis, call)) gates.add(gate)
    found.push({
      key: `${relName}.${declaration.name.text}`,
      node: declaration,
      method,
      gates,
    })
  })
  return found
}

// ---------------------------------------------------------------------------------------------
// Runtime calls
// ---------------------------------------------------------------------------------------------

const USED = {
  runtime: "the runtime",
  ManagedRuntime: "ManagedRuntime",
  "run-function": "an Effect run function",
}

const runtimeViolations = (analysis, allowed) => {
  const problems = []
  walk(analysis.sf, (node) => {
    if (insideImport(node)) return
    const isName = node.kind === K.Identifier
    if (
      !isName &&
      node.kind !== K.PropertyAccessExpression &&
      node.kind !== K.ElementAccessExpression
    )
      return
    if (isName && !isReference(node)) return
    if (isName && node.parent.kind === K.PropertyAccessExpression && node.parent.name === node)
      return
    const descriptor = analysis.resolve(node)
    if (descriptor === "run-function" || descriptor === "ManagedRuntime") {
      if (!allowed) problems.push([node, descriptor])
      return
    }
    if (descriptor !== "runtime") return
    const parent = node.parent
    const isMember =
      (parent.kind === K.PropertyAccessExpression || parent.kind === K.ElementAccessExpression) &&
      parent.expression === node
    const alias =
      (parent.kind === K.VariableDeclaration && parent.initializer === node) ||
      (parent.kind === K.BinaryExpression &&
        parent.operatorToken.kind === K.EqualsToken &&
        parent.right === node)
    if (!isMember && !alias && !allowed) problems.push([node, "runtime"])
  })
  return problems
}

// ---------------------------------------------------------------------------------------------
// Worker routes
// ---------------------------------------------------------------------------------------------

const HTTP_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
const ROUTE_FORM =
  '`export const <name>Meta = { path: "/x/*", methods: ["GET"], access: "read" | "mutation" } as const`'

const readMeta = (declaration) => {
  const init = declaration.initializer && unwrap(declaration.initializer)
  if (init?.kind !== K.ObjectLiteralExpression) return undefined
  const meta = {}
  for (const property of init.properties) {
    if (property.kind !== K.PropertyAssignment || property.name?.kind !== K.Identifier)
      return undefined
    const key = property.name.text
    const value = unwrap(property.initializer)
    if (key === "path" || key === "access") {
      if (!isStringLike(value) || key in meta) return undefined
      meta[key] = value.text
    } else if (key === "methods") {
      if (value.kind !== K.ArrayLiteralExpression || key in meta) return undefined
      if (!value.elements.every((element) => isStringLike(unwrap(element)))) return undefined
      meta.methods = value.elements.map((element) => unwrap(element).text)
    } else return undefined
  }
  const valid =
    Object.keys(meta).length === 3 &&
    meta.path.startsWith("/") &&
    meta.methods.length > 0 &&
    meta.methods.every((method) => HTTP_METHODS.has(method)) &&
    (meta.access === "read" || meta.access === "mutation")
  return valid ? meta : undefined
}

const methodGuards = (node) => {
  const literals = []
  walk(node, (inner) => {
    if (
      inner.kind !== K.BinaryExpression ||
      ![
        K.EqualsEqualsEqualsToken,
        K.ExclamationEqualsEqualsToken,
        K.EqualsEqualsToken,
        K.ExclamationEqualsToken,
      ].includes(inner.operatorToken.kind)
    )
      return
    const [a, b] = [unwrap(inner.left), unwrap(inner.right)]
    for (const [access, literal] of [
      [a, b],
      [b, a],
    ])
      if (
        access.kind === K.PropertyAccessExpression &&
        access.name.text === "method" &&
        isStringLike(literal)
      )
        literals.push(literal.text)
  })
  return literals
}

const checkRoutes = (analyses, routesFile) => {
  const analysis = analyses.get(routesFile)
  const found = analysis && findConst(analysis.sf, "workerRoutes")
  const array = found?.declaration.initializer && unwrap(found.declaration.initializer)
  if (array?.kind !== K.ArrayLiteralExpression) {
    failFile(routesFile, "`workerRoutes` must be an array literal of identifiers")
    return 0
  }
  for (const element of array.elements) {
    if (element.kind !== K.Identifier) {
      fail(
        element,
        "a workerRoutes element must be an identifier imported from a file under server/ (a spread, call or other expression is unsupported syntax)",
      )
      continue
    }
    const imported = analysis.imports.get(element.text)
    if (imported === undefined || !imported.module.startsWith("./") || imported.name === "*") {
      fail(
        element,
        `\`${element.text}\` must be a named import from a file under server/ (\`import { ${element.text} } from "./...")\``,
      )
      continue
    }
    const file = [".ts", ".tsx"]
      .map((extension) => join(serverDir, imported.module + extension))
      .find((path) => analyses.has(path))
    if (file === undefined) {
      fail(element, `${imported.module} is not a source file under server/`)
      continue
    }
    const target = analyses.get(file)
    const route = findConst(target.sf, imported.name)
    const metaName = `${imported.name}Meta`
    const metaFound = findConst(target.sf, metaName)
    if (route === undefined || !exported(route.statement)) {
      fail(element, `${rel(file)} does not export \`${imported.name}\``)
      continue
    }
    const meta =
      metaFound && exported(metaFound.statement) ? readMeta(metaFound.declaration) : undefined
    if (meta === undefined) {
      fail(
        metaFound?.declaration ?? route.declaration,
        `route \`${imported.name}\` needs a static classification next to it: ${ROUTE_FORM} (strings only)`,
      )
      continue
    }
    const routeAt = route.declaration
    if (meta.access === "read") {
      const bad = meta.methods.filter((method) => method !== "GET" && method !== "HEAD")
      if (bad.length > 0)
        fail(
          routeAt,
          `\`${imported.name}\` is access "read" but handles ${bad.join(", ")}; classify it "mutation" and call mutation(), or restrict it to GET and HEAD`,
        )
      const guards = methodGuards(route.declaration)
      if (guards.length === 0)
        fail(
          routeAt,
          `\`${imported.name}\` is access "read" and needs a method guard (compare \`request.method\` with a string and return undefined or a 405)`,
        )
      for (const guard of guards)
        if (!meta.methods.includes(guard))
          fail(
            routeAt,
            `\`${imported.name}\` compares the method with "${guard}", which ${metaName}.methods does not list`,
          )
    } else if (
      meta.path !== "/api/auth/*" &&
      !gatesCalledIn(target, route.declaration).has("mutation")
    )
      fail(
        routeAt,
        `\`${imported.name}\` is access "mutation" but is not /api/auth/* and does not call mutation(...)`,
      )
  }
  return array.elements.length
}

// ---------------------------------------------------------------------------------------------

const api = new API({ cwd: root })
try {
  const snapshot = api.updateSnapshot({ openProject: join(webDir, "tsconfig.json") })
  const project = snapshot
    .getProjects()
    .find((candidate) => candidate.configFileName.endsWith("apps/web/tsconfig.json"))
  if (project === undefined) throw new Error("apps/web/tsconfig.json did not open as a project")

  const analyses = new Map()
  for (const file of listSources(srcDir)) {
    const sf = project.program.getSourceFile(file)
    if (sf === undefined)
      failFile(file, "is not part of the apps/web TypeScript project, so the check cannot read it")
    else analyses.set(file, analyze(sf))
  }

  const registryFile = join(serverDir, "entry-points.ts")
  const registry = analyses.has(registryFile)
    ? readRegistry(analyses.get(registryFile).sf)
    : undefined
  if (registry === undefined) failFile(registryFile, "is missing")
  const entries = registry?.entries ?? new Map()
  const allowedFiles = new Set(registry?.allowed ?? [])

  for (const name of allowedFiles)
    if (!analyses.has(join(serverDir, name)))
      failFile(registryFile, `RUNTIME_ALLOWED lists ${name}, which does not exist under server/`)

  const functions = new Map()
  for (const [file, analysis] of analyses) {
    const inServer = file.startsWith(serverDir + "/")
    const relName = slash(relative(serverDir, file)).replace(/\.tsx?$/, "")
    const allowed = inServer && allowedFiles.has(slash(relative(serverDir, file)))

    for (const statement of analysis.sf.statements) {
      if (statement.kind !== K.ExportDeclaration || statement.moduleSpecifier === undefined)
        continue
      const clause = statement.exportClause
      const names =
        clause?.kind === K.NamedExports
          ? clause.elements.map((element) => (element.propertyName ?? element.name).text)
          : []
      if (
        names.includes("createServerFn") ||
        (clause === undefined && moduleKind(statement.moduleSpecifier.text) !== undefined)
      )
        fail(
          statement,
          "re-exporting createServerFn (or a module that holds it) is unsupported syntax; import it where it is used",
        )
    }

    if (!inServer) {
      walk(analysis.sf, (node) => {
        if (node.kind !== K.ImportDeclaration) return
        const bindings = node.importClause?.namedBindings
        if (
          bindings?.kind === K.NamedImports &&
          bindings.elements.some(
            (element) => (element.propertyName ?? element.name).text === "createServerFn",
          )
        )
          fail(node, "server functions belong under apps/web/src/server/")
      })
    }

    for (const node of inServer ? analysis.dynamic : []) {
      const argument = node.arguments[0]
      if (argument === undefined || !isStringLike(unwrap(argument)))
        fail(
          node,
          "a dynamic import() with a computed specifier is unsupported syntax (it would load code the check cannot read)",
        )
      else if (!allowed && unwrap(argument).text.startsWith("."))
        fail(
          node,
          "a dynamic import() of a server module is unsupported syntax outside RUNTIME_ALLOWED; import it statically",
        )
    }

    for (const [node, what] of runtimeViolations(analysis, allowed))
      fail(
        node,
        `${USED[what]} is used outside RUNTIME_ALLOWED; run Effects through mutation()/read()/respond() from ./server-fn, or add a Worker route or entry file to RUNTIME_ALLOWED in entry-points.ts`,
      )

    for (const fn of serverFunctions(analysis, relName)) {
      functions.set(fn.key, fn)
      const access = entries.get(fn.key)
      if (access === undefined) {
        fail(
          fn.node,
          `server function ${fn.key} is not in ENTRY_POINTS (apps/web/src/server/entry-points.ts); add it as "read" or "mutation"`,
        )
        continue
      }
      if (access !== "read" && access !== "mutation") {
        fail(fn.node, `ENTRY_POINTS["${fn.key}"] must be "read" or "mutation", not "${access}"`)
        continue
      }
      if (!["GET", "POST"].includes(fn.method))
        fail(fn.node, `${fn.key} uses method ${fn.method}; use GET (read) or POST (mutation)`)
      else if (access === "mutation") {
        if (fn.method !== "POST")
          fail(
            fn.node,
            `${fn.key} is a "mutation" entry but its method is ${fn.method}; mutations are POST`,
          )
        if (!fn.gates.has("mutation"))
          fail(
            fn.node,
            `${fn.key} is a "mutation" entry but its handler does not call mutation(...)`,
          )
        for (const gate of GATES.filter((g) => g !== "mutation" && fn.gates.has(g)))
          fail(
            fn.node,
            `${fn.key} is a "mutation" entry but its handler also calls ${gate}(...); use mutation(...) only`,
          )
      } else {
        if (fn.method === "POST")
          fail(
            fn.node,
            `${fn.key} is registered "read" but its method is POST; register it "mutation" and call mutation(...)`,
          )
        for (const gate of ["mutation", "respond"].filter((g) => fn.gates.has(g)))
          fail(
            fn.node,
            `${fn.key} is registered "read" but its handler calls ${gate}(...); use read(...)`,
          )
      }
    }
  }

  for (const key of entries.keys())
    if (!functions.has(key))
      failFile(
        registryFile,
        `ENTRY_POINTS lists ${key}, but no such server function exists; remove the entry`,
      )

  const routeCount = checkRoutes(analyses, join(serverDir, "routes.ts"))
  if (failures.length === 0)
    process.stdout.write(
      `entry points ok: ${functions.size} server functions, ${routeCount} Worker routes, ${analyses.size} files\n`,
    )
} catch (error) {
  failures.push(
    `the check could not run (${error instanceof Error ? error.message : String(error)}); failing closed`,
  )
} finally {
  api.close()
}

if (failures.length > 0) {
  console.error(`\nEntry-point check failed (${failures.length}):\n`)
  for (const message of failures) console.error(`  ${message}`)
  console.error('\nHow to register: AGENTS.md, section "Entry points".')
  process.exitCode = 1
}
