BEGIN TRY

BEGIN TRAN;

-- Enlace de la invitación por correo: solo se guarda el hash del token y su vencimiento.
ALTER TABLE [dbo].[BoardInvite] ADD
    [tokenHash] VARCHAR(64),
    [tokenExpiresAt] DATETIME2;

-- CreateIndex
CREATE NONCLUSTERED INDEX [BoardInvite_tokenHash_idx] ON [dbo].[BoardInvite]([tokenHash]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
