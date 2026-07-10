using System.Text.Json;
using GTrace.Parser.Parsing;
using Xunit;

namespace GTrace.Parser.Tests;

public class ReadOnlyValidatorTests
{
    private static ValidateResultDto Validate(string sql)
    {
        var json = JsonSerializer.Serialize(new { sql, compatLevel = 150 });
        using var doc = JsonDocument.Parse(json);
        return ReadOnlyValidator.Handle(doc.RootElement);
    }

    [Theory]
    [InlineData("SELECT * FROM dbo.Client;")]
    [InlineData("SELECT TOP 10 Id, Nom FROM dbo.Client WHERE Actif = 1 ORDER BY Nom;")]
    [InlineData("DECLARE @id int = 5; SELECT * FROM dbo.Client WHERE ClientId = @id;")]
    [InlineData("WITH c AS (SELECT Id FROM dbo.T) SELECT * FROM c;")]
    public void Pure_selects_are_allowed(string sql)
    {
        Assert.Empty(Validate(sql).Violations);
    }

    [Theory]
    [InlineData("UPDATE dbo.Client SET Nom = 'x';", "UpdateStatement")]
    [InlineData("INSERT INTO dbo.Client VALUES (1);", "InsertStatement")]
    [InlineData("DELETE FROM dbo.Client;", "DeleteStatement")]
    [InlineData("DROP TABLE dbo.Client;", "DropTableStatement")]
    [InlineData("EXEC dbo.MaProc;", "ExecuteStatement")]
    [InlineData("TRUNCATE TABLE dbo.Client;", "TruncateTableStatement")]
    public void Non_select_statements_are_rejected(string sql, string expectedType)
    {
        var result = Validate(sql);
        Assert.Contains(result.Violations, v => v.Type == expectedType);
    }

    [Fact]
    public void Select_into_is_rejected()
    {
        var result = Validate("SELECT * INTO dbo.Copie FROM dbo.Source;");
        Assert.Contains(result.Violations, v => v.Type == "SELECT INTO");
    }

    [Theory]
    [InlineData("SELECT * FROM OPENROWSET('SQLNCLI', 'x', 'SELECT 1');", "openrowset")]
    [InlineData("SELECT * FROM OPENQUERY(srv, 'SELECT 1');", "openquery")]
    [InlineData("SELECT * FROM sys.fn_my_permissions(NULL, 'X');", "fn_")]
    public void Blacklisted_constructs_are_rejected(string sql, string banned)
    {
        var result = Validate(sql);
        Assert.Contains(result.Violations, v => v.Target == banned);
    }

    [Fact]
    public void Multi_statement_with_hidden_write_is_rejected()
    {
        var result = Validate("SELECT 1; UPDATE dbo.T SET C = 1;");
        Assert.Contains(result.Violations, v => v.Type == "UpdateStatement");
    }
}
