BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[CardEvent] (
    [id] VARCHAR(36) NOT NULL,
    [boardId] VARCHAR(36) NOT NULL,
    [cardId] VARCHAR(36) NOT NULL,
    [type] VARCHAR(20) NOT NULL,
    [fromColumnId] VARCHAR(36),
    [toColumnId] VARCHAR(36),
    [at] DATETIME2 NOT NULL CONSTRAINT [CardEvent_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [CardEvent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CardEvent_boardId_at_idx] ON [dbo].[CardEvent]([boardId], [at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CardEvent_cardId_idx] ON [dbo].[CardEvent]([cardId]);

-- AddForeignKey
ALTER TABLE [dbo].[CardEvent] ADD CONSTRAINT [CardEvent_boardId_fkey] FOREIGN KEY ([boardId]) REFERENCES [dbo].[Board]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
