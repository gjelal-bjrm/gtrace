using GTrace.Parser.Instrumentation;
using Microsoft.SqlServer.TransactSql.ScriptDom;
using Xunit;

namespace GTrace.Parser.Tests;

public class SnapshotInstrumentationTests
{
    private const string Script = """
        CREATE TABLE #tmp (Id int, Val int);
        DECLARE @t TABLE (Id int);
        INSERT INTO #tmp VALUES (1, 10);
        INSERT INTO @t VALUES (1);
        UPDATE #tmp SET Val = 20 WHERE Id = 1;
        DELETE FROM #tmp WHERE Id = 99;
        SELECT * FROM #tmp;
        """;

    [Fact]
    public void Snapshots_are_injected_after_each_write_to_target_tables()
    {
        var result = Instrumenter.Instrument(Script, 150, null, ["#tmp", "@t"]);
        Assert.Empty(result.Errors);
        // #tmp : INSERT + UPDATE + DELETE = 3 ; @t : INSERT = 1.
        Assert.Equal(3, CountOccurrences(result.Script, "N'#tmp' AS _tbl"));
        Assert.Equal(1, CountOccurrences(result.Script, "N'@t' AS _tbl"));
        // Le SELECT final (lecture seule) ne déclenche pas de snapshot.
        Assert.Equal(4, CountOccurrences(result.Script, $"'{Instrumenter.SnapTag}'"));
    }

    [Fact]
    public void Snapshot_mode_preserves_lines_and_reparses()
    {
        var result = Instrumenter.Instrument(Script, 150, null, ["#tmp", "@t"]);
        Assert.Equal(Script.Count(c => c == '\n'), result.Script.Count(c => c == '\n'));
        var parser = new TSql150Parser(initialQuotedIdentifiers: true);
        parser.Parse(new StringReader(result.Script), out var errors);
        Assert.True(errors.Count == 0,
            string.Join(" | ", errors.Select(e => $"L{e.Line} {e.Message}")) + "\n" + result.Script);
    }

    [Fact]
    public void Snapshot_comes_after_trace_so_rowcount_is_intact()
    {
        var result = Instrumenter.Instrument(Script, 150, null, ["#tmp"]);
        var insertLine = result.Script.Split('\n')[2]; // INSERT INTO #tmp
        var tracePos = insertLine.IndexOf(Instrumenter.TraceTag, StringComparison.Ordinal);
        var snapPos = insertLine.IndexOf(Instrumenter.SnapTag, StringComparison.Ordinal);
        Assert.True(tracePos >= 0 && snapPos > tracePos, insertLine);
    }

    [Fact]
    public void Unmatched_targets_inject_nothing()
    {
        var result = Instrumenter.Instrument(Script, 150, null, ["#autre"]);
        Assert.DoesNotContain(Instrumenter.SnapTag, result.Script);
    }

    [Fact]
    public void Malicious_snapshot_target_is_rejected()
    {
        var json = System.Text.Json.JsonDocument.Parse(
            """{"sql":"SELECT 1;","snapshots":["#tmp; DROP TABLE T--"]}""");
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
