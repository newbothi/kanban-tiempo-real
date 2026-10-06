BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[User] (
    [id] VARCHAR(36) NOT NULL,
    [email] NVARCHAR(254) NOT NULL,
    [name] NVARCHAR(100) NOT NULL,
    [passwordHash] VARCHAR(100) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [User_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [User_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [User_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[BoardMember] (
    [boardId] VARCHAR(36) NOT NULL,
    [userId] VARCHAR(36) NOT NULL,
    [role] VARCHAR(20) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BoardMember_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BoardMember_pkey] PRIMARY KEY CLUSTERED ([boardId],[userId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BoardMember_userId_idx] ON [dbo].[BoardMember]([userId]);

-- AddForeignKey
ALTER TABLE [dbo].[BoardMember] ADD CONSTRAINT [BoardMember_boardId_fkey] FOREIGN KEY ([boardId]) REFERENCES [dbo].[Board]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[BoardMember] ADD CONSTRAINT [BoardMember_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
