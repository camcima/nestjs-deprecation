import { DEPRECATION_METADATA_KEY } from './deprecation.constants';
import { DeprecatedOptions } from './deprecation.interfaces';
import { buildDeprecationMetadata } from './deprecation.metadata';

/**
 * Marks a handler method or controller class as deprecated.
 *
 * Emits RFC 9745 `Deprecation`, RFC 8594 `Sunset`, and RFC 8288 `Link`
 * response headers via the interceptor registered by DeprecationModule.
 * Purely informational: never changes endpoint behavior.
 *
 * Invalid options throw here, at decoration time, so misconfiguration
 * fails the application at boot rather than silently at request time.
 */
export function Deprecated(options: DeprecatedOptions): MethodDecorator & ClassDecorator {
  return ((
    target: object | (new (...args: never[]) => unknown),
    propertyKey?: string | symbol,
    descriptor?: TypedPropertyDescriptor<unknown>,
  ) => {
    if (propertyKey !== undefined) {
      // On a member decorator, `target` is the prototype for instance members
      // and the constructor itself for static ones.
      const isStatic = typeof target === 'function';
      const owner = isStatic
        ? (target as { name?: string }).name
        : (target.constructor as { name?: string } | undefined)?.name;
      const where = `${owner ?? 'anonymous class'}.${String(propertyKey)}`;
      if (isStatic) {
        throw new Error(
          `[nestjs-deprecation] ${where}: @Deprecated() cannot decorate a static method — Nest routes instance methods only.`,
        );
      }
      // Getters and properties silently miss both the interceptor and the
      // Swagger transform, which read metadata off the handler function.
      if (typeof descriptor?.value !== 'function') {
        throw new Error(
          `[nestjs-deprecation] ${where}: @Deprecated() must decorate a controller class or a route handler method, but "${String(propertyKey)}" is not a method.`,
        );
      }
      Reflect.defineMetadata(
        DEPRECATION_METADATA_KEY,
        buildDeprecationMetadata(options, where),
        descriptor.value as object,
      );
      return descriptor;
    }
    const where = (target as { name?: string }).name ?? 'anonymous class';
    Reflect.defineMetadata(
      DEPRECATION_METADATA_KEY,
      buildDeprecationMetadata(options, where),
      target,
    );
    return target;
  }) as MethodDecorator & ClassDecorator;
}
