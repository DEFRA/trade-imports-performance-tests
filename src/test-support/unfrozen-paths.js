export const unfrozenPaths = (value, path = '') =>
  Object.entries(value).reduce(
    (paths, [key, child]) =>
      child && typeof child === 'object'
        ? [...paths, ...unfrozenPaths(child, `${path}.${key}`)]
        : paths,
    Object.isFrozen(value) ? [] : [path || '(root)']
  )
