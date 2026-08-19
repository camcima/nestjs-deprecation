import { DynamicModule, FactoryProvider, Module, Provider, Type } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DEPRECATION_MODULE_OPTIONS } from './deprecation.constants';
import { DeprecationInterceptor, validateModuleOptions } from './deprecation.interceptor';
import { DeprecationModuleOptions, DeprecationOptionsFactory } from './deprecation.interfaces';

export interface DeprecationModuleAsyncOptions {
  imports?: DynamicModule['imports'];
  /** Provide exactly one of useFactory, useClass, or useExisting. */
  useFactory?: (...args: any[]) => DeprecationModuleOptions | Promise<DeprecationModuleOptions>;
  inject?: FactoryProvider['inject'];
  /** Class to instantiate and ask for the options. */
  useClass?: Type<DeprecationOptionsFactory>;
  /** Already-provided class (e.g. exported by an imported module) to ask for the options. */
  useExisting?: Type<DeprecationOptionsFactory>;
}

@Module({})
export class DeprecationModule {
  static forRoot(options: DeprecationModuleOptions = {}): DynamicModule {
    // Options are known here, so misconfiguration surfaces as the module is
    // defined rather than when the interceptor is instantiated — and the
    // kill switch can be honored by not registering the interceptor at all.
    validateModuleOptions(options);
    const providers: Provider[] = [{ provide: DEPRECATION_MODULE_OPTIONS, useValue: options }];
    if (options.enabled !== false) {
      providers.push({ provide: APP_INTERCEPTOR, useClass: DeprecationInterceptor });
    }
    return {
      module: DeprecationModule,
      providers,
      exports: [DEPRECATION_MODULE_OPTIONS],
    };
  }

  static forRootAsync(asyncOptions: DeprecationModuleAsyncOptions): DynamicModule {
    return {
      module: DeprecationModule,
      imports: asyncOptions.imports ?? [],
      providers: [
        ...createOptionsProviders(asyncOptions),
        // The kill switch is only known once the factory has run, so unlike
        // forRoot() the interceptor is always registered and checks at runtime.
        { provide: APP_INTERCEPTOR, useClass: DeprecationInterceptor },
      ],
      exports: [DEPRECATION_MODULE_OPTIONS],
    };
  }
}

function createOptionsProviders(asyncOptions: DeprecationModuleAsyncOptions): Provider[] {
  if (asyncOptions.useFactory) {
    return [
      {
        provide: DEPRECATION_MODULE_OPTIONS,
        useFactory: asyncOptions.useFactory,
        inject: asyncOptions.inject ?? [],
      },
    ];
  }

  const factoryType = asyncOptions.useExisting ?? asyncOptions.useClass;
  if (!factoryType) {
    throw new Error(
      '[nestjs-deprecation] DeprecationModule.forRootAsync() requires "useFactory", "useClass", or "useExisting".',
    );
  }

  const providers: Provider[] = [
    {
      provide: DEPRECATION_MODULE_OPTIONS,
      useFactory: (factory: DeprecationOptionsFactory) => factory.createDeprecationOptions(),
      inject: [factoryType],
    },
  ];
  // useExisting expects the class to be provided elsewhere; useClass owns it.
  if (asyncOptions.useClass) {
    providers.push({ provide: asyncOptions.useClass, useClass: asyncOptions.useClass });
  }
  return providers;
}
