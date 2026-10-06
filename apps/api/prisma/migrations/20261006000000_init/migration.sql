BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Board] (
    [id] VARCHAR(36) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Board_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Board_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
-- NOTA: [position] usa COLLATE Latin1_General_BIN2 (agregado a mano).
-- Las claves de fractional indexing deben ordenarse byte a byte;
-- con la collation por defecto (case-insensitive) el ORDER BY desordena las columnas.
CREATE TABLE [dbo].[Column] (
    [id] VARCHAR(36) NOT NULL,
    [boardId] VARCHAR(36) NOT NULL,
    [title] NVARCHAR(100) NOT NULL,
    [position] VARCHAR(255) COLLATE Latin1_General_BIN2 NOT NULL,
    CONSTRAINT [Column_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
-- NOTA: misma collation binaria en [position].
CREATE TABLE [dbo].[Card] (
    [id] VARCHAR(36) NOT NULL,
    [columnId] VARCHAR(36) NOT NULL,
    [title] NVARCHAR(500) NOT NULL,
    [position] VARCHAR(255) COLLATE Latin1_General_BIN2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Card_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Card_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Column_boardId_position_idx] ON [dbo].[Column]([boardId], [position]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Card_columnId_position_idx] ON [dbo].[Card]([columnId], [position]);

-- AddForeignKey
ALTER TABLE [dbo].[Column] ADD CONSTRAINT [Column_boardId_fkey] FOREIGN KEY ([boardId]) REFERENCES [dbo].[Board]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Card] ADD CONSTRAINT [Card_columnId_fkey] FOREIGN KEY ([columnId]) REFERENCES [dbo].[Column]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
