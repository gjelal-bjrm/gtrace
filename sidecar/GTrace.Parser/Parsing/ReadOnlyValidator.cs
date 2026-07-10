using System.Text.Json;
using Microsoft.SqlServer.TransactSql.ScriptDom;

namespace GTrace.Parser.Parsing;

/// <summary>
/// Validation stricte « lecture seule » pour les requêtes ad hoc exposées à l'IA
/// (spec Phase 6 §3.4.1) : seuls des SELECT purs sont acceptés. Tout le reste
/// (INSERT/UPDATE/DELETE/MERGE/DDL/EXEC, SELECT INTO, CTE avec écriture) est rejeté,
/// plus une liste noire de fonctions/procédures à effet de bord (§8).
/// </summary>
public static class ReadOnlyValidator
{
    // Procédures/fonctions étendues et rowset providers interdits même en "SELECT".
    private static readonly string[] BlacklistSubstrings =
    [
        "openrowset", "openquery", "opendatasource", "openxml",
        "xp_", "sp_oa", "sp_execute", "fn_"
    ];

    public static ValidateResultDto Handle(JsonElement parameters)
    {
        var sql = parameters.GetProperty("sql").GetString() ?? string.Empty;
        var compatLevel = parameters.TryGetProperty("compatLevel", out var c) ? c.GetInt32() : 150;

        var parser = ParserFactory.Create(compatLevel);
        var fragment = parser.Parse(new StringReader(sql), out var parseErrors);
        var errors = parseErrors
            .Select(e => new ParseErrorDto(e.Number, e.Line, e.Column, e.Message))
            .ToList();
        if (fragment == null || errors.Count > 0)
            return new ValidateResultDto([], errors);

        var visitor = new ReadOnlyVisitor();
        fragment.Accept(visitor);

        // Liste noire textuelle (défense en profondeur au-delà de l'AST).
        var lower = sql.ToLowerInvariant();
        foreach (var banned in BlacklistSubstrings)
        {
            if (lower.Contains(banned))
                visitor.Violations.Add(new ValidateViolationDto(0, "interdit", banned));
        }

        return new ValidateResultDto(visitor.Violations, errors);
    }

    private sealed class ReadOnlyVisitor : TSqlFragmentVisitor
    {
        public List<ValidateViolationDto> Violations { get; } = [];

        // Tout statement de premier niveau qui n'est pas un SELECT est refusé.
        public override void Visit(TSqlStatement node)
        {
            switch (node)
            {
                case SelectStatement select:
                    if (select.Into != null)
                        Violations.Add(new ValidateViolationDto(node.StartLine, "SELECT INTO", "matérialisation interdite"));
                    break;
                case DeclareVariableStatement:
                case SetVariableStatement:
                    break; // toléré : n'écrit rien en base, utile pour paramétrer un SELECT
                case BeginEndBlockStatement:
                    break; // conteneur
                default:
                    Violations.Add(new ValidateViolationDto(
                        node.StartLine, node.GetType().Name, "seuls les SELECT sont autorisés"));
                    break;
            }
        }
    }
}
