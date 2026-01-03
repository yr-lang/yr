# yr syntax

## Triggers

### `[[` Variables

Wrapper variables. Should be added to the first line of the file

```
[[ attributes=["big"]; icon="alert"
```

Know variables:

- icon: icon of the wrapper (bootstrap)
- attributes: list of attributes of the wrapper
- disable\_children: toggle wrapper ability to have children (defaults to false)

### `!!` Require

Imports other .yr files:

```yr
!! Ui/Modal
```

Wrappers must be capitalized, e.g. `!! Ui/Code`

### `--` NPM Modules

Install dependencies at build:

```yr
-- express,crypto
```

### `_` Element

Used to place other wrappers or HTML elements. Only usable inside HTML sections.

- Can call known HTML tags: `div`, `span`, etc.
- Wrappers are called by category/name: `_code/repl`
- Wrappers must be capitalized inside `$LIB`: e.g. `$LIB/Code/Repl.ya`
- Wrapper calls are expected to be lowercase, but not required.
- If calling a wrapper is followed by `!`, it tells `yr` to ignore all HTML sections: `==`, `>>`, `><`, `<<`, `<>`, `++`.

### `?? | ?_ | //` Conditionals

Conditional logic based on environment (options.env).

Inline:

```yr
?? _allow :: !! Ui/Password ?_ !! Ui/Login
```

Multiline:

```yr
++

?? _allow
  _ .green
?? _warn
  _ .yellow
?_
  _ .red
//
```

---

## Sections

### `%%` Macros

Reusable functions usable in all sections:

```
_@macro(#var, #optional=default) {
  ___
@}
```

- Begins with `_@name()` and ends with `@}`
- Variables prefixed with `#`
- `___` for code insertion
- If a value is not passed, default is `false`

### `==` Pixel

Placed **inside** HTML output before `<head>`.

### `>>` Head

Placed **inside** `<head>` tag.

### `><` Body

Placed **inside** `<body>` tag, before Footer section.

### `<>` Footer

Placed **right before** `</body>` tag.

### `<<` Scripts

Placed **after** `</body>`. Where inline `<script>` blocks are inserted.

### `++` Wrapper

Defines the structure of a wrapper file:

- `___` marks where a child will be inserted.
- If `___` not used, child appends to last root element.
- If the file has a wrapper section (`++`), all data inside it will be available to be added as a child of the parent calling it.
- If this file also has a `@>` section with a `_@wrapper(Category, Option)` call, and matches the Category/Option.yr structure, the macro is invoked for the parent container div, using `!! @wrapper`.
- Every wrapper is added inside a `div` with a unique class used to trigger the matching function inside `@wrapper.yr`.

### `##` CSS

Placed before `</head>`:

```html
<style>
...
</style>
```

### `@@` Frontend JS`

Front-end logic.

JS blocks grouped as:

- `@>`: JS placed before `@@`
- `@@`: Main JS body
- `@<`: JS placed after `@@`

Placed after `</body>`:

```html
<script>
...
</script>
```

### `&&` Backend JS

Back-end logic written as `app.js`.

JS blocks grouped as:

- `&>`: JS placed before `&&`
- `&&`: Main JS body
- `&<`: JS placed after `&&`

### `@&` Shared JS

JS or logic to be used by both backend and frontend. Placed before `&>` and `@>`.

### `**` DevOps

Code used in stages:

```yr
**
___build
# bash or js script here
```

To specify the stage, use `___stageName` . By default, stage is `build` 

```
**
___serve
# bash or js script here
```

Known stages: `build`, `serve`, `deploy` . By default, `build` is executed when `yr.build` is called

### `$$` Web3

Reserved for Ethereum or blockchain-related logic.
