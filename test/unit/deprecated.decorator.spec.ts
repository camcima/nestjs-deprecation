import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { DEPRECATION_METADATA_KEY } from '../../src/deprecation.constants';
import { Deprecated } from '../../src/deprecated.decorator';

const reflector = new Reflector();

describe('@Deprecated', () => {
  it('stores metadata on a method, readable via Reflector', () => {
    class OrdersController {
      @Deprecated({ deprecatedAt: '2026-07-01T00:00:00Z' })
      list() {
        return [];
      }
    }
    const metadata = reflector.getAllAndOverride(DEPRECATION_METADATA_KEY, [
      OrdersController.prototype.list,
      OrdersController,
    ]);
    expect(metadata).toMatchObject({ deprecationHeader: '@1782864000' });
  });

  it('stores metadata on a class', () => {
    @Deprecated({ deprecatedAt: '2026-07-01T00:00:00Z' })
    class LegacyController {
      list() {
        return [];
      }
    }
    const metadata = reflector.getAllAndOverride(DEPRECATION_METADATA_KEY, [
      LegacyController.prototype.list,
      LegacyController,
    ]);
    expect(metadata).toMatchObject({ deprecationHeader: '@1782864000' });
  });

  it('method-level metadata overrides class-level', () => {
    @Deprecated({ deprecatedAt: '2020-01-01T00:00:00Z' })
    class MixedController {
      @Deprecated({ deprecatedAt: '2026-07-01T00:00:00Z' })
      newer() {
        return [];
      }
      older() {
        return [];
      }
    }
    const newer = reflector.getAllAndOverride(DEPRECATION_METADATA_KEY, [
      MixedController.prototype.newer,
      MixedController,
    ]);
    const older = reflector.getAllAndOverride(DEPRECATION_METADATA_KEY, [
      MixedController.prototype.older,
      MixedController,
    ]);
    expect(newer).toMatchObject({ deprecationHeader: '@1782864000' });
    expect(older).toMatchObject({ deprecationHeader: '@1577836800' });
  });

  it('throws at decoration time with the controller and handler named', () => {
    expect(() => {
      class BadController {
        @Deprecated({ deprecatedAt: 'not-a-date' })
        broken() {
          return [];
        }
      }
      return BadController;
    }).toThrow(/BadController\.broken.*"deprecatedAt"/s);
  });

  it('rejects decoration of a getter, which no route handler can be', () => {
    expect(() => {
      class GetterController {
        @Deprecated({ deprecatedAt: '2026-07-01T00:00:00Z' })
        get orders() {
          return [];
        }
      }
      return GetterController;
    }).toThrow(/GetterController\.orders.*is not a method/s);
  });

  it('rejects decoration of a property', () => {
    class PropertyController {}
    // What TypeScript emits for a property decorator: no descriptor at all.
    const decorate = Deprecated({ deprecatedAt: '2026-07-01T00:00:00Z' }) as (
      target: object,
      propertyKey: string,
      descriptor?: undefined,
    ) => unknown;
    expect(() => decorate(PropertyController.prototype, 'orders', undefined)).toThrow(
      /PropertyController\.orders.*is not a method/s,
    );
  });

  it('rejects decoration of a static method, which Nest never routes', () => {
    expect(() => {
      class StaticController {
        @Deprecated({ deprecatedAt: '2026-07-01T00:00:00Z' })
        static list() {
          return [];
        }
      }
      return StaticController;
    }).toThrow(/StaticController\.list.*static method/s);
  });
});
