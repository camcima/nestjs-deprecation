'use strict';
// A CommonJS application: everything is loaded through require(). On Nest 12
// that includes the require(esm) hop into Nest's ESM-only packages.
require('reflect-metadata');
const { Controller, Get, Module } = require('@nestjs/common');
const { DiscoveryModule, NestFactory } = require('@nestjs/core');
const { DocumentBuilder, SwaggerModule } = require('@nestjs/swagger');
const { Deprecated, DeprecationModule } = require('@camcima/nestjs-deprecation');
const { applyDeprecationDocs } = require('@camcima/nestjs-deprecation/swagger');
const { createOtelDeprecationListener } = require('@camcima/nestjs-deprecation/otel');
const { runSmoke } = require('./run-smoke.cjs');

runSmoke(
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
  'require',
).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
