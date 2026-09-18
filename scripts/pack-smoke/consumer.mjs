// An ESM application: everything is loaded through import. The library's
// CommonJS entry points must expose named exports here, and must resolve the
// same Nest instances the application imports — otherwise DI tokens such as
// Reflector would not match and the app would fail to boot.
import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { DiscoveryModule, NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Deprecated, DeprecationModule } from '@camcima/nestjs-deprecation';
import { applyDeprecationDocs } from '@camcima/nestjs-deprecation/swagger';
import { createOtelDeprecationListener } from '@camcima/nestjs-deprecation/otel';
import { runSmoke } from './run-smoke.cjs';

await runSmoke(
  {
    Controller,
    Get,
    Module,
    NestFactory,
    DiscoveryModule,
    SwaggerModule,
    DocumentBuilder,
    Deprecated,
    DeprecationModule,
    applyDeprecationDocs,
    createOtelDeprecationListener,
  },
  'import',
);
