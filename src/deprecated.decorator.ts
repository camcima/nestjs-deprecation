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
    if (propertyKey !== undefined && descriptor?.value) {
      const where = `${target.constructor.name}.${String(propertyKey)}`;
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
