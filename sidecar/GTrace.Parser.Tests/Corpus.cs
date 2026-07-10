namespace GTrace.Parser.Tests;

/// <summary>
/// Corpus de scripts T-SQL de complexité croissante pour les tests d'instrumentation.
/// </summary>
public static class Corpus
{
    public const string SimpleScript = """
        DECLARE @total decimal(18,2);
        DECLARE @qte int = 3;
        SET @total = @qte * 9.90;
        SELECT @total AS Total;
        """;

    public const string IfWithoutBeginEnd = """
        DECLARE @x int = 1;
        IF @x > 0
          SET @x = @x + 1;
        ELSE
          SET @x = 0;
        SELECT @x AS X;
        """;

    public const string WhileSingleStatement = """
        DECLARE @i int = 0;
        WHILE @i < 5
          SET @i = @i + 1;
        SELECT @i AS I;
        """;

    public const string TryCatchWithThrow = """
        DECLARE @x int;
        BEGIN TRY
          SET @x = 1;
          RAISERROR('boom', 16, 1);
          SET @x = 2;
        END TRY
        BEGIN CATCH
          SET @x = -1;
          THROW;
        END CATCH
        SELECT @x AS X;
        """;

    public const string RowcountReader = """
        DECLARE @n int;
        UPDATE dbo.T SET Col = 1 WHERE Id = 42;
        IF @@ROWCOUNT = 0
          SET @n = -1;
        SET @n = 7;
        SELECT @n AS N;
        """;

    public const string CursorLoop = """
        DECLARE @id int;
        DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT Id FROM dbo.T;
        OPEN c;
        FETCH NEXT FROM c INTO @id;
        WHILE @@FETCH_STATUS = 0
        BEGIN
          UPDATE dbo.T SET Col = Col + 1 WHERE Id = @id;
          FETCH NEXT FROM c INTO @id;
        END
        CLOSE c;
        DEALLOCATE c;
        """;

    public const string DynamicSql = """
        DECLARE @sql nvarchar(200) = N'SELECT 1 AS Un';
        EXEC (@sql);
        EXEC sp_executesql @sql;
        """;

    public const string ProcedureWithParams = """
        CREATE PROCEDURE dbo.CalculeTotal
          @CommandeId int,
          @TauxRemise decimal(5,4) = 0.05,
          @Total decimal(18,2) OUTPUT
        AS
        BEGIN
          SET NOCOUNT ON;
          DECLARE @qte int, @prix decimal(18,2);
          SELECT @qte = SUM(Quantite), @prix = AVG(PrixUnitaire)
          FROM dbo.LigneCommande
          WHERE CommandeId = @CommandeId;
          IF @qte IS NULL
          BEGIN
            RAISERROR('Commande introuvable', 16, 1);
          END
          SET @Total = @qte * @prix * (1 - @TauxRemise);
        END
        """;

    public const string ProcedureWithReturn = """
        CREATE PROCEDURE dbo.Verifie
          @Id int
        AS
        BEGIN
          IF @Id IS NULL
            RETURN 1;
          DECLARE @n int;
          SELECT @n = COUNT(*) FROM dbo.T WHERE Id = @Id;
          RETURN 0;
        END
        """;

    public const string ProcedureReturnWithOutput = """
        CREATE PROCEDURE dbo.AvecSortie
          @Id int,
          @Statut nvarchar(20) OUTPUT
        AS
        BEGIN
          SET @Statut = N'inconnu';
          IF @Id IS NULL
          BEGIN
            SET @Statut = N'invalide';
            RETURN 1;
          END
          SET @Statut = N'ok';
          RETURN 0;
        END
        """;

    public const string NestedComplex = """
        CREATE PROCEDURE dbo.Complexe
          @Mode int
        AS
        BEGIN
          SET NOCOUNT ON;
          DECLARE @i int = 0, @total decimal(18,2) = 0;
          BEGIN TRY
            WHILE @i < 10
            BEGIN
              SET @i = @i + 1;
              IF @Mode = 1
              BEGIN
                UPDATE dbo.T SET Col = Col + 1 WHERE Id = @i;
                IF @@ROWCOUNT = 0
                  SET @total = @total - 1;
              END
              ELSE
                SET @total = @total + @i;
            END
          END TRY
          BEGIN CATCH
            SET @total = -1;
          END CATCH
          SELECT @total AS Total;
        END
        """;

    /// <summary>Tous les scripts « script libre » (sans CREATE PROCEDURE).</summary>
    public static readonly (string Name, string Sql)[] Scripts =
    [
        (nameof(SimpleScript), SimpleScript),
        (nameof(IfWithoutBeginEnd), IfWithoutBeginEnd),
        (nameof(WhileSingleStatement), WhileSingleStatement),
        (nameof(TryCatchWithThrow), TryCatchWithThrow),
        (nameof(RowcountReader), RowcountReader),
        (nameof(CursorLoop), CursorLoop),
        (nameof(DynamicSql), DynamicSql)
    ];

    /// <summary>Toutes les procédures.</summary>
    public static readonly (string Name, string Sql)[] Procedures =
    [
        (nameof(ProcedureWithParams), ProcedureWithParams),
        (nameof(ProcedureWithReturn), ProcedureWithReturn),
        (nameof(ProcedureReturnWithOutput), ProcedureReturnWithOutput),
        (nameof(NestedComplex), NestedComplex)
    ];

    public static readonly (string Name, string Sql)[] All = [.. Scripts, .. Procedures];
}
