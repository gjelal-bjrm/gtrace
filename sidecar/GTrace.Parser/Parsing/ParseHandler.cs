using System.Text.Json;
using Microsoft.SqlServer.TransactSql.ScriptDom;

namespace GTrace.Parser.Parsing;

public static class ParseHandler
{
    public static string ScriptDomVersion =>
        typeof(TSqlParser).Assembly.GetName().Version?.ToString() ?? "?";

    public static ParseResultDto Handle(JsonElement parameters)
    {
        var sql = parameters.GetProperty("sql").GetString() ?? string.Empty;
        var compatLevel = parameters.TryGetProperty("compatLevel", out var c) ? c.GetInt32() : 150;

        var parser = ParserFactory.Create(compatLevel);
        var fragment = parser.Parse(new StringReader(sql), out var parseErrors);

        var errors = parseErrors
            .Select(e => new ParseErrorDto(e.Number, e.Line, e.Column, e.Message))
            .ToList();

        if (fragment == null)
            return new ParseResultDto([], [], errors);

        var collector = new StatementCollector();
        fragment.Accept(collector);
        collector.ResolveReferences();

        var statements = collector.Statements
            .Select((entry, index) =>
            {
                var node = entry.Node;
                var (endLine, endColumn) = FragmentUtils.EndPosition(node);
                return new StatementDto(
                    index,
                    node.GetType().Name,
                    entry.Depth,
                    node.StartLine,
                    node.StartColumn,
                    endLine,
                    endColumn,
                    entry.Declared,
                    entry.Referenced);
            })
            .ToList();

        return new ParseResultDto(statements, collector.Variables, errors);
    }

}
