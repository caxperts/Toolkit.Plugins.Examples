-- GENERATED FILE — do not hand-edit.
--
-- Idempotent equivalent of the plugin's EF migrations, for customers where the application's SQL
-- login does not hold CREATE SCHEMA / CREATE TABLE and a DBA applies schema changes by hand
-- (Plugins:AutoMigrate=false). It also inserts the __EFMigrationsHistory rows, or a later run with
-- AutoMigrate=true would try to create tables that already exist.
--
-- PluginMigrationScriptTests asserts this file equals what EF generates from the migrations in
-- HelloDbContext.cs, so the two cannot drift. To regenerate after changing a migration: run that test,
-- and copy the 001_plg_hello.sql.actual it writes next to the test assembly over this file — keeping
-- this comment header, which the comparison ignores.
--
-- `dotnet ef migrations script` is NOT the way to produce this. Against a plugin library it cannot run:
-- Microsoft.EntityFrameworkCore.Design is PrivateAssets=all in Toolkit.Data so it does not flow to a
-- plugin, and a library has no startup project for the tool to build a DbContext from. The test uses
-- IMigrator.GenerateScript in-process instead, which needs neither — see PLUGINS.md.

IF OBJECT_ID(N'[plg_hello].[__EFMigrationsHistory]') IS NULL
BEGIN
    IF SCHEMA_ID(N'plg_hello') IS NULL EXEC(N'CREATE SCHEMA [plg_hello];');
    CREATE TABLE [plg_hello].[__EFMigrationsHistory] (
        [MigrationId] nvarchar(150) NOT NULL,
        [ProductVersion] nvarchar(32) NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );
END;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [plg_hello].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260803120000_InitialHello'
)
BEGIN
    IF SCHEMA_ID(N'plg_hello') IS NULL EXEC(N'CREATE SCHEMA [plg_hello];');
END;

IF NOT EXISTS (
    SELECT * FROM [plg_hello].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260803120000_InitialHello'
)
BEGIN
    CREATE TABLE [plg_hello].[Greetings] (
        [Id] int NOT NULL IDENTITY,
        [Message] nvarchar(400) NOT NULL,
        [CreatedBySubject] nvarchar(64) NOT NULL,
        [CreatedByEmail] nvarchar(320) NOT NULL,
        [CreatedAtUtc] datetime2 NOT NULL,
        CONSTRAINT [PK_Greetings] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [plg_hello].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260803120000_InitialHello'
)
BEGIN
    CREATE INDEX [IX_Greetings_CreatedBySubject_Id] ON [plg_hello].[Greetings] ([CreatedBySubject], [Id] DESC);
END;

IF NOT EXISTS (
    SELECT * FROM [plg_hello].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260803120000_InitialHello'
)
BEGIN
    INSERT INTO [plg_hello].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260803120000_InitialHello', N'10.0.10');
END;

COMMIT;
GO
