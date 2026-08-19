import { DynamicModule, FactoryProvider, Module, Provider } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DEPRECATION_MODULE_OPTIONS } from './deprecation.constants';
import { DeprecationInterceptor, validateModuleOptions } from './deprecation.interceptor';
import { DeprecationModuleOptions } from './deprecation.interfaces';

export interface DeprecationModuleAsyncOptions {
  imports?: DynamicModule['imports'];
  useFactory: (...args: any[]) => DeprecationModuleOptions | Promise<DeprecationModuleOptions>;
  inject?: FactoryProvider['inject'];
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
        {
          provide: DEPRECATION_MODULE_OPTIONS,
          useFactory: asyncOptions.useFactory,
          inject: asyncOptions.inject ?? [],
        },
        { provide: APP_INTERCEPTOR, useClass: DeprecationInterceptor },
      ],
      exports: [DEPRECATION_MODULE_OPTIONS],
    };
  }
}
