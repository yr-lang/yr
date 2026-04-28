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

### Wrappers calls are not being called in the correct order

e.g, if I have

#### Test/N2

```
!! @wrapper

++

_ .something


@>

_@wrapper(Test, N2) {
  console.log('n2');
@}
```

#### Test/N1

```
!! @wrapper

++

_test/n2

@>

_@wrapper(Test, N1) {
  console.log('n1');
@}
```

My output becomes

```
__Teste_N1({});
__Teste_N2({});
```

Instead of

```
__Teste_N2({});
__Teste_N1({});
```

That means that the wrapper calls might be swapping the orders, or some other
behaviour, which is incorrect. The correct would be:

* The calls of the imported wrappers must come first

The workaround for this issues is to add the code that relies on the child
wrappers calls, inside a `setTimeout`, so it goes to the next event loop.