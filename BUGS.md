## Known Issues

This file documents known bugs and limitations in yr.
The project is under active development.

### Wrapper-only section closure ✓ Fixed in 0.2.0

Previously, a section could not always be closed using only a wrapper and required an explicit
`_` element. This has been resolved — the following now works as expected:

```
++
_ .teste
  _wrapper/test
    _ .teste2
    _wrapper/test2
```
