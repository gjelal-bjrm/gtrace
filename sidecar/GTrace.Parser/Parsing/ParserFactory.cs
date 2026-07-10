using Microsoft.SqlServer.TransactSql.ScriptDom;

namespace GTrace.Parser.Parsing;

public static class ParserFactory
{
    public static TSqlParser Create(int compatLevel) => compatLevel switch
    {
        >= 160 => new TSql160Parser(initialQuotedIdentifiers: true),
        >= 150 => new TSql150Parser(initialQuotedIdentifiers: true),
        >= 140 => new TSql140Parser(initialQuotedIdentifiers: true),
        >= 130 => new TSql130Parser(initialQuotedIdentifiers: true),
        >= 120 => new TSql120Parser(initialQuotedIdentifiers: true),
        _ => new TSql110Parser(initialQuotedIdentifiers: true)
    };
}
