using GTrace.Parser.Instrumentation;
using Microsoft.SqlServer.TransactSql.ScriptDom;
using Xunit;

namespace GTrace.Parser.Tests;

public class PauseInstrumentationTests
{
    private static readonly PauseOptions Pause = new(
        "11111111-2222-3333-4444-555555555555",
        new HashSet<int> { 2 },
        "GTraceDB.dbo.ControlSignal");

    [Fact]
    public void Pause_mode_preserves_line_count_and_reparses()
    {
        foreach (var (name, sql) in Corpus.All)
        {
            var result = Instrumenter.Instrument(sql, 150, Pause);
            Assert.True(result.Errors.Count == 0, $"{name}: {string.Join('|', result.Errors.Select(e => e.Message))}");
            Assert.Equal(sql.Count(c => c == '\n'), result.Script.Count(c => c == '\n'));

            var parser = new TSql150Parser(initialQuotedIdentifiers: true);
            parser.Parse(new StringReader(result.Script), out var errors);
            Assert.True(errors.Count == 0,
                $"{name}: {string.Join('|', errors.Select(e => $"L{e.Line} {e.Message}"))}\n{result.Script}");
        }
    }

    [Fact]
    public void Pause_mode_keeps_statement_indexes_identical_to_normal_mode()
    {
        foreach (var (_, sql) in Corpus.All)
        {
            var normal = Instrumenter.Instrument(sql);
            var paused = Instrumenter.Instrument(sql, 150, Pause);
            Assert.Equal(
                normal.Statements.Select(s => (s.Index, s.Type, s.StartLine, s.Traced)),
                paused.Statements.Select(s => (s.Index, s.Type, s.StartLine, s.Traced)));
        }
    }

    [Fact]
    public void Preamble_declares_counter_and_session_id()
    {
        var result = Instrumenter.Instrument(Corpus.SimpleScript, 150, Pause);
        Assert.Contains("DECLARE @__gt_seq int = 0", result.Script);
        Assert.Contains("'11111111-2222-3333-4444-555555555555'", result.Script);
    }

    [Fact]
    public void Every_traced_statement_gets_a_pause_block_except_rowcount_readers()
    {
        var result = Instrumenter.Instrument(Corpus.RowcountReader, 150, Pause);
        // Un incrément de seq par bloc de pause.
        var pauseBlocks = CountOccurrences(result.Script, "SET @__gt_seq = @__gt_seq + 1;");
        var expected = result.Statements.Count(s => s.Kind == "statement" && s.Traced);
        Assert.Equal(expected, pauseBlocks);
        // Le tag n'apparaît que dans les blocs (une émission par bloc).
        Assert.Equal(pauseBlocks, CountOccurrences(result.Script, $"'{Instrumenter.PauseTag}'"));
    }

    [Fact]
    public void Statement_reading_rowcount_gets_no_pause_block()
    {
        // SET @n = @@ROWCOUNT : un bloc de pause juste avant corromprait la valeur.
        var sql = "UPDATE dbo.T SET C = 1;\nDECLARE @n int;\nSET @n = @@ROWCOUNT;\nSELECT @n AS N;";
        var result = Instrumenter.Instrument(sql, 150, Pause);
        Assert.Empty(result.Errors);
        var lines = result.Script.Split('\n');
        Assert.DoesNotContain(Instrumenter.PauseTag, lines[2]); // ligne du SET @n = @@ROWCOUNT
        Assert.Contains(Instrumenter.PauseTag, lines[3]); // le SELECT suivant, lui, est pausable
    }

    [Fact]
    public void Breakpoint_blocks_do_not_honor_run_to_breakpoint_bypass()
    {
        var result = Instrumenter.Instrument(Corpus.SimpleScript, 150, Pause);
        // 4 statements tracés (indexes 0..3) ; breakpoint sur l'index 2.
        // Chaque bloc non-breakpoint contient 2× « RunToBreakpoint = 1 » (IF + WHILE),
        // le bloc breakpoint : 0.
        var pauseBlocks = CountOccurrences(result.Script, "SET @__gt_seq = @__gt_seq + 1;");
        var bypasses = CountOccurrences(result.Script, "RunToBreakpoint = 1");
        Assert.Equal((pauseBlocks - 1) * 2, bypasses);
    }

    [Fact]
    public void Invalid_control_table_is_rejected()
    {
        var json = System.Text.Json.JsonDocument.Parse(
            """{"sql":"SELECT 1;","pause":{"sessionId":"11111111-2222-3333-4444-555555555555","breakpoints":[],"controlTable":"X; DROP TABLE T--"}}""");
        Assert.ThrowsAny<Exception>(() => Instrumenter.Handle(json.RootElement));
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
