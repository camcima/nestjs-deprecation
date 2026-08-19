import 'reflect-metadata';
import { Injectable, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { DEPRECATION_MODULE_OPTIONS } from '../../src/deprecation.constants';
import { DeprecationInterceptor } from '../../src/deprecation.interceptor';
import {
  DeprecationModuleOptions,
  DeprecationOptionsFactory,
} from '../../src/deprecation.interfaces';
import { DeprecationModule } from '../../src/deprecation.module';

describe('DeprecationModule', () => {
  it('forRoot provides the options and registers a global interceptor', async () => {
    const listener = () => undefined;
    const moduleRef = await Test.createTestingModule({
      imports: [DeprecationModule.forRoot({ enabled: true, onDeprecatedCall: listener })],
    }).compile();

    const options = moduleRef.get<DeprecationModuleOptions>(DEPRECATION_MODULE_OPTIONS);
    expect(options).toEqual({ enabled: true, onDeprecatedCall: listener });

    const dynamicModule = DeprecationModule.forRoot();
    expect(dynamicModule.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provide: APP_INTERCEPTOR, useClass: DeprecationInterceptor }),
      ]),
    );
  });

  it('forRoot defaults to empty options', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DeprecationModule.forRoot()],
    }).compile();
    expect(moduleRef.get<DeprecationModuleOptions>(DEPRECATION_MODULE_OPTIONS)).toEqual({});
  });

  it('omits the global interceptor when disabled synchronously', () => {
    const dynamicModule = DeprecationModule.forRoot({ enabled: false });
    expect(dynamicModule.providers).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ provide: APP_INTERCEPTOR })]),
    );
  });

  it('keeps the interceptor for forRootAsync, where enabled is unknown until runtime', () => {
    const dynamicModule = DeprecationModule.forRootAsync({
      useFactory: async () => ({ enabled: false }),
    });
    expect(dynamicModule.providers).toEqual(
      expect.arrayContaining([expect.objectContaining({ provide: APP_INTERCEPTOR })]),
    );
  });

  it('validates synchronous options when the module is defined', () => {
    expect(() => DeprecationModule.forRoot({ onDeprecatedCall: 'nope' } as never)).toThrow(
      /"onDeprecatedCall" must be a function/,
    );
    expect(() => DeprecationModule.forRoot({ enabled: 'yes' } as never)).toThrow(
      /"enabled" must be a boolean/,
    );
  });

  it('forRootAsync resolves options from a useClass options factory', async () => {
    class DeprecationConfig implements DeprecationOptionsFactory {
      createDeprecationOptions(): DeprecationModuleOptions {
        return { enabled: false };
      }
    }
    const moduleRef = await Test.createTestingModule({
      imports: [DeprecationModule.forRootAsync({ useClass: DeprecationConfig })],
    }).compile();
    expect(moduleRef.get<DeprecationModuleOptions>(DEPRECATION_MODULE_OPTIONS)).toEqual({
      enabled: false,
    });
  });

  it('forRootAsync resolves options from a useExisting provider', async () => {
    @Injectable()
    class DeprecationConfig implements DeprecationOptionsFactory {
      async createDeprecationOptions(): Promise<DeprecationModuleOptions> {
        return { enabled: true };
      }
    }
    @Module({ providers: [DeprecationConfig], exports: [DeprecationConfig] })
    class ConfigModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        DeprecationModule.forRootAsync({
          imports: [ConfigModule],
          useExisting: DeprecationConfig,
        }),
      ],
    }).compile();
    expect(moduleRef.get<DeprecationModuleOptions>(DEPRECATION_MODULE_OPTIONS)).toEqual({
      enabled: true,
    });
  });

  it('forRootAsync requires one of useFactory, useClass or useExisting', () => {
    expect(() => DeprecationModule.forRootAsync({})).toThrow(
      /requires "useFactory", "useClass", or "useExisting"/,
    );
  });

  it('forRootAsync resolves options from a factory', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        DeprecationModule.forRootAsync({
          useFactory: async () => ({ enabled: false }),
        }),
      ],
    }).compile();
    expect(moduleRef.get<DeprecationModuleOptions>(DEPRECATION_MODULE_OPTIONS)).toEqual({
      enabled: false,
    });

    const dynamicModule = DeprecationModule.forRootAsync({
      useFactory: async () => ({ enabled: false }),
    });
    expect(dynamicModule.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provide: APP_INTERCEPTOR, useClass: DeprecationInterceptor }),
      ]),
    );
  });
});
