using System.Text.Json;
using GTrace.Parser.Parsing;
using Xunit;

namespace GTrace.Parser.Tests;

public class ValidatorTests
{
    private static ValidateResultDto Validate(string sql, params string[] whitelist)
    {
        var json = JsonSerializer.Serialize(new { sql, compatLevel = 150, whitelist });
        using var doc = JsonDocument.Parse(json);
        return Validator.Handle(doc.RootElement);
    }

    [Fact]
    public void Temp_tables_and_table_variables_are_allowed()
    {
        var result = Validate("""
            CREATE TABLE #tmp (Id int);
            DECLARE @t TABLE (Id int);
            INSERT INTO #tmp VALUES (1);
            INSERT INTO @t VALUES (1);
            UPDATE #tmp SET Id = 2;
            DELETE FROM @t;
            DROP TABLE #tmp;
            SELECT 1 AS X;
            """);
        Assert.Empty(result.Violations);
    }

    [Fact]
    public void Writes_to_real_tables_are_violations_with_line_numbers()
    {
        var result = Validate("""
            SELECT * FROM dbo.Lecture;
            INSERT INTO dbo.Cible VALUES (1);
            UPDATE ventes.Commande SET Statut = N'X';
            DELETE FROM dbo.Log;
            TRUNCATE TABLE dbo.Log;
            SELECT Nom INTO dbo.Copie FROM dbo.Source;
            """);
        Assert.Equal(5, result.Violations.Count);
        Assert.Equal([2, 3, 4, 5, 6], result.Violations.Select(v => v.Line).OrderBy(l => l));
        Assert.Contains(result.Violations, v => v.Type == "TRUNCATE" && v.Target == "Log");
        Assert.Contains(result.Violations, v => v.Type == "SELECT INTO" && v.Target == "Copie");
    }

    [Fact]
    public void Whitelisted_tables_are_allowed()
    {
        var result = Validate(
            "INSERT INTO dbo.JournalAutorise VALUES (1);\nINSERT INTO dbo.Interdit VALUES (1);",
            "dbo.JournalAutorise");
        var violation = Assert.Single(result.Violations);
        Assert.Equal("Interdit", violation.Target);
    }

    [Fact]
    public void Exec_and_dynamic_sql_are_flagged_opaque()
    {
        var result = Validate("""
            DECLARE @sql nvarchar(100) = N'SELECT 1';
            EXEC (@sql);
            EXEC dbo.MaProc 1;
            EXEC sp_executesql @sql;
            """);
        Assert.Equal(3, result.Violations.Count);
        Assert.All(result.Violations, v => Assert.Equal("EXEC (opaque)", v.Type));
        Assert.Contains(result.Violations, v => v.Target == "(SQL dynamique)");
        Assert.Contains(result.Violations, v => v.Target == "dbo.MaProc");
    }

    [Fact]
    public void Whitelisted_proc_exec_is_allowed()
    {
        var result = Validate("EXEC dbo.ProcSure;", "dbo.ProcSure");
        Assert.Empty(result.Violations)
;
    }

    [Fact]
    public void Ddl_on_real_tables_is_flagged()
    {
        var result = Validate("""
            CREATE TABLE dbo.Neuve (Id int);
            ALTER TABLE dbo.Existante ADD Col int;
            """);
        Assert.Equal(2, result.Violations.Count)
;
    }
}
