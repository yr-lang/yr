## Bugs

### Wrapper-only section closure can fail

In some cases, a section cannot be closed using only a wrapper, and must instead be closed explicitly with an element (_).

For example, the following may result in an error:

```
++
_ .teste
  _wrapper/test
    _ .teste2
    _wrapper/test2
```

However, explicitly closing the section with elements works as expected:

```
++
_ .teste
  _wrapper/test
    _ .teste2
    _wrapper/test2
    _
  _
```

#### Notes

* This appears to be related to how section termination is detected when the last node is a wrapper.
* The parser may not recognize wrappers as valid closing tokens in some nesting scenarios.
