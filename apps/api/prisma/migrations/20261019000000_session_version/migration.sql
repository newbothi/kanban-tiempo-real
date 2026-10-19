BEGIN TRY

BEGIN TRAN;

-- S-10: versión de sesión por usuario. Al cerrar sesión se incrementa y todos
-- los JWT emitidos antes (con la versión anterior) dejan de valer.
ALTER TABLE [dbo].[User] ADD [sessionVersion] INT NOT NULL CONSTRAINT [User_sessionVersion_df] DEFAULT 0;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
