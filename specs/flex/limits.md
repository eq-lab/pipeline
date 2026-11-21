Status: approved

# Limits of tool inputs

A tool clamps the number of items a caller asks for, so one call never returns an unbounded result. This sample proves the spec runner; the tools themselves get their own specs.

## A missing limit takes the default

```spec
query:
  ClampLimit: { max: 500, fallback: 100 }
then:
  limit: 100
```

## A limit within the maximum is kept

```spec
query:
  ClampLimit: { limit: 20, max: 500, fallback: 100 }
then:
  limit: 20
```

## A limit above the maximum is clamped to it

```spec
query:
  ClampLimit: { limit: 1000, max: 500, fallback: 100 }
then:
  limit: 500
```
