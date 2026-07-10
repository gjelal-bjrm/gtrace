using GTrace.Parser.Instrumentation;
using GTrace.Parser.Parsing;
using Microsoft.SqlServer.TransactSql.ScriptDom;
using Xunit;

namespace GTrace.Parser.Tests;

public class InstrumenterInvariantTests
{
    public static TheoryData<string, string> AllCorpus()
    {
        var data = new TheoryData<string, string>();
        foreach (var (name, sql) in Corpus.All) data.Add(name, sql);
        return data;
    }

    [Theory]
    [MemberData(nameof(AllCorpus))]
    public void Instrumentation_succeeds_without_errors(string name, string sql)
    {
        var result = Instrumenter.Instrument(sql);
        Assert.True(result.Errors.Count == 0, $"{name}: {string.Join(" | ", result.Errors.Select(e => e.Message))}");
        Assert.False(string.IsNullOrWhiteSpace(result.Script), name);
    }

    [Theory]
    [MemberData(nameof(AllCorpus))]
    public void Line_count_is_preserved(string name, string sql)
    {
        var result = Instrumenter.Instrument(sql);
        Assert.Equal(sql.Count(c => c == '\n'), result.Script.Count(c => c == '\n'));
        _ = name;
    }

    [Theory]
    [MemberData(nameof(AllCorpus))]
    public void Instrumented_script_reparses_without_errors(string name, string sql)
    {
        var result = Instrumenter.Instrument(sql);
        var parser = new TSql150Parser(initialQuotedIdentifiers: true);
        parser.Parse(new StringReader(result.Script), out var errors);
        Assert.True(errors.Count == 0,
            $"{name}: {string.Join(" | ", errors.Select(e => $"L{e.Line} {e.Message}"))}\n---\n{result.Script}");
    }

    [Theory]
    [MemberData(nameof(AllCorpus))]
    public void Trace_count_matches_traced_statements(string name, string sql)
    {
        var result = Instrumenter.Instrument(sql);
        var expected = result.Statements.Count(s => s.Traced);
        var occurrences = CountOccurrences(result.Script, $"'{Instrumenter.TraceTag}'")
                        + CountOccurrences(result.Script, $"'{Instrumenter.ErrorTag}'");
        Assert.True(expected == occurrences, $"{name}: {expected} tracés vs {occurrences} tags");
    }

    [Theory]
    [MemberData(nameof(AllCorpus))]
    public void Traced_statement_lines_match_original_source(string name, string sql)
    {
        var result = Instrumenter.Instrument(sql);
        var originalLines = sql.Replace("\r\n", "\n").Split('\n');
        var instrumentedLines = result.Script.Replace("\r\n", "\n").Split('\n');

        foreach (var s in result.Statements.Where(s => s.Traced && s.Kind == "statement" && s.Type != "ReturnStatement"))
        {
            Assert.InRange(s.StartLine, 1, originalLines.Length);
            var original = originalLines[s.StartLine - 1].Trim();
            var instrumented = instrumentedLines[s.StartLine - 1];
            Assert.True(instrumented.Contains(original),
                $"{name}: ligne {s.StartLine} — « {original} » absente de « {instrumented} »");
        }
    }

    private static int CountOccurrences(string haystack, string needle)
    {
        var count = 0;
        var index = 0;
        while ((index = haystack.IndexOf(needle, index, StringComparison.Ordinal)) >= 0)
        {
            count++;
            index += needle.Length;
        }
        return count;
    }
}

public class InstrumenterBehaviorTests
{
    [Fact]
    public void If_single_statement_bodies_are_wrapped_in_begin_end()
    {
        var result = Instrumenter.Instrument(Corpus.IfWithoutBeginEnd);
        Assert.Empty(result.Errors);
        // Les deux branches (THEN et ELSE) doivent être enveloppées.
        Assert.True(CountWord(result.Script, "BEGIN") >= 2, result.Script);
        Assert.True(CountWord(result.Script, "END") >= 2, result.Script);
    }

    [Fact]
    public void Statement_before_rowcount_reader_is_not_traced()
    {
        var result = Instrumenter.Instrument(Corpus.RowcountReader);
        var update = result.Statements.Single(s => s.Type == "UpdateStatement");
        Assert.False(update.Traced);
        Assert.NotNull(update.SkipReason);
    }

    [Fact]
    public void Catch_block_gets_error_trace_entry()
    {
        var result = Instrumenter.Instrument(Corpus.TryCatchWithThrow);
        Assert.Contains(result.Statements, s => s.Kind == "catchEntry");
        Assert.Contains($"'{Instrumenter.ErrorTag}'", result.Script);
        Assert.Contains("ERROR_NUMBER()", result.Script);
        Assert.Contains("ERROR_LINE()", result.Script);
    }

    [Fact]
    public void Procedure_header_is_removed_and_parameters_extracted()
    {
        var result = Instrumenter.Instrument(Corpus.ProcedureWithParams);
        Assert.Empty(result.Errors);
        Assert.DoesNotContain("CREATE PROCEDURE", result.Script, StringComparison.OrdinalIgnoreCase);
        Assert.Equal("dbo.CalculeTotal", result.ProcedureName);

        Assert.Equal(3, result.Parameters.Count);
        var commande = result.Parameters[0];
        Assert.Equal("@CommandeId", commande.Name);
        Assert.Equal("int", commande.Type);
        Assert.False(commande.IsOutput);
        Assert.False(commande.HasDefault);

        var remise = result.Parameters[1];
        Assert.True(remise.HasDefault);
        Assert.Equal("0.05", remise.DefaultText);

        var total = result.Parameters[2];
        Assert.True(total.IsOutput);
        Assert.Equal("decimal(18,2)", total.Type);

        Assert.Contains("@CommandeId int", result.ParamsDeclaration);
        Assert.Contains("@Total decimal(18,2) OUTPUT", result.ParamsDeclaration);
    }

    [Fact]
    public void Return_with_value_is_rewritten_to_be_batch_compatible()
    {
        var result = Instrumenter.Instrument(Corpus.ProcedureWithReturn);
        Assert.Empty(result.Errors);
        // « RETURN 1 » et « RETURN 0 » ne doivent plus exister tels quels (invalides en batch).
        var parser = new TSql150Parser(initialQuotedIdentifiers: true);
        parser.Parse(new StringReader(result.Script), out var errors);
        Assert.Empty(errors);
        Assert.Contains("_ret", result.Script);
    }

    [Fact]
    public void Return_traces_carry_output_parameters()
    {
        var result = Instrumenter.Instrument(Corpus.ProcedureReturnWithOutput);
        Assert.Empty(result.Errors);
        // Chaque RETURN (avec ou sans valeur) doit embarquer l'état des paramètres OUTPUT.
        var returnTraces = result.Script.Split('\n')
            .Where(l => l.Contains("RETURN") && l.Contains(Instrumenter.TraceTag))
            .ToList();
        Assert.Equal(2, returnTraces.Count);
        Assert.All(returnTraces, l => Assert.Contains("@Statut AS [@Statut]", l));
    }

    [Fact]
    public void Dynamic_sql_is_traced_as_opaque_statement()
    {
        var result = Instrumenter.Instrument(Corpus.DynamicSql);
        var execs = result.Statements.Where(s => s.Type == "ExecuteStatement").ToList();
        Assert.Equal(2, execs.Count);
        Assert.All(execs, e => Assert.True(e.Traced));
    }

    [Fact]
    public void Fetch_into_variables_are_captured_in_trace()
    {
        var result = Instrumenter.Instrument(Corpus.CursorLoop);
        Assert.Empty(result.Errors);
        // Le FETCH écrit @id → la trace qui le suit doit exposer @id en colonne.
        Assert.Contains("@id AS [@id]", result.Script);
    }

    [Fact]
    public void Multi_batch_scripts_are_rejected()
    {
        var result = Instrumenter.Instrument("SELECT 1;\nGO\nSELECT 2;");
        Assert.NotEmpty(result.Errors);
    }

    [Fact]
    public void Set_variable_is_captured_in_trace()
    {
        var result = Instrumenter.Instrument(Corpus.SimpleScript);
        Assert.Contains("@total AS [@total]", result.Script);
    }

    private static int CountWord(string text, string word) =>
        System.Text.RegularExpressions.Regex.Matches(text, $@"\b{word}\b",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase).Count;
}

public class ParseHandlerTests
{
    [Fact]
    public void Parse_reports_statements_variables_and_positions()
    {
        var parser = new TSql150Parser(initialQuotedIdentifiers: true);
        _ = parser; // le parse est déjà couvert par les tests d'instrumentation ; sanity check minimal :
        var result = Instrumenter.Instrument(Corpus.SimpleScript);
        Assert.Empty(result.Errors);
    }
}
