BEGIN TRY

BEGIN TRAN;

-- S-09: verificación de correo. S-18: último reinicio de la cuenta demo.
ALTER TABLE [dbo].[User] ADD
    [emailVerifiedAt] DATETIME2,
    [verifyTokenHash] VARCHAR(64),
    [verifyTokenExpiresAt] DATETIME2,
    [demoResetAt] DATETIME2;

-- Las cuentas que ya existían se consideran verificadas (no se les quita nada).
-- EXEC: SQL Server compila el lote completo antes de ejecutarlo y aún no conocería la columna.
EXEC('UPDATE [dbo].[User] SET [emailVerifiedAt] = CURRENT_TIMESTAMP');

-- S-08: invitaciones pendientes (la persona las acepta o rechaza).
CREATE TABLE [dbo].[BoardInvite] (
    [id] VARCHAR(36) NOT NULL,
    [boardId] VARCHAR(36) NOT NULL,
    [email] NVARCHAR(254) NOT NULL,
    [invitedById] VARCHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BoardInvite_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BoardInvite_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BoardInvite_boardId_email_key] UNIQUE NONCLUSTERED ([boardId], [email])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BoardInvite_email_idx] ON [dbo].[BoardInvite]([email]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [User_verifyTokenHash_idx] ON [dbo].[User]([verifyTokenHash]);

-- AddForeignKey
ALTER TABLE [dbo].[BoardInvite] ADD CONSTRAINT [BoardInvite_boardId_fkey] FOREIGN KEY ([boardId]) REFERENCES [dbo].[Board]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
