using System.Text.Json;
using Microsoft.SqlServer.TransactSql.ScriptDom;

namespace GTrace.Parser.Parsing;

public sealed record ValidateViolationDto(int Line, string Type, string Target);

public sealed record ValidateResultDto(
    IReadOnlyList<ValidateViolationDto> Violations,
    IReadOnlyList<ParseErrorDto> Errors);

/// <summary>
/// Mode lecture seule strict (spec Phase 5) : détection statique des écritures
/// hors #temp / variables tables / liste blanche. Les EXEC (procs, dynamic SQL)
/// sont signalés comme opaques — impossible de garantir qu'ils ne modifient rien.
/// Analyse volontairement conservatrice : faux positifs possibles (ex. alias
/// UPDATE), jamais de faux négatifs sur les statements analysables.
/// </summary>
public static class Validator
{
    public static ValidateResultDto Handle(JsonElement parameters)
    {
        var sql = parameters.GetProperty("sql").GetString() ?? string.Empty;
        var compatLevel = parameters.TryGetProperty("compatLevel", out var c) ? c.GetInt32() : 150;
        var whitelist = new HashSet<string>(StringComparer.Ordinal);
        if (parameters.TryGetProperty("whitelist", out var w) && w.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in w.EnumerateArray())
            {
                var name = item.GetString();
                if (!string.IsNullOrWhiteSpace(name)) whitelist.Add(Normalize(name));
            }
        }

        var parser = ParserFactory.Create(compatLevel);
        var fragment = parser.Parse(new StringReader(sql), out var parseErrors);
        var errors = parseErrors
            .Select(e => new ParseErrorDto(e.Number, e.Line, e.Column, e.Message))
            .ToList();

        if (fragment == null || errors.Count > 0)
            return new ValidateResultDto([], errors);

        var visitor = new WriteScanVisitor(whitelist);
        fragment.Accept(visitor);
        return new ValidateResultDto(visitor.Violations, errors);
    }

    internal static string Normalize(string name)
    {
        var last = name.Split('.')[^1];
        return last.Replace("[", "").Replace("]", "").ToLowerInvariant();
    }

    private sealed class WriteScanVisitor(IReadOnlySet<string> whitelist) : TSqlFragmentVisitor
    {
        public List<ValidateViolationDto> Violations { get; } = [];

        public override void Visit(InsertSpecification node) => CheckTarget(node.Target, node, "INSERT");
        public override void Visit(UpdateSpecification node) => CheckTarget(node.Target, node, "UPDATE");
        public override void Visit(DeleteSpecification node) => CheckTarget(node.Target, node, "DELETE");
        public override void Visit(MergeSpecification node) => CheckTarget(node.Target, node, "MERGE");

        public override void Visit(SelectStatement node)
        {
            if (node.Into != null) CheckName(node.Into.BaseIdentifier.Value, node, "SELECT INTO");
        }

        public override void Visit(CreateTableStatement node) =>
            CheckName(node.SchemaObjectName.BaseIdentifier.Value, node, "CREATE TABLE");

        public override void Visit(DropTableStatement node)
        {
            foreach (var obj in node.Objects)
                CheckName(obj.BaseIdentifier.Value, node, "DROP TABLE");
        }

        public override void Visit(TruncateTableStatement node) =>
            CheckName(node.TableName.BaseIdentifier.Value, node, "TRUNCATE");

        public override void Visit(AlterTableStatement node) =>
            CheckName(node.SchemaObjectName.BaseIdentifier.Value, node, "ALTER TABLE");

        public override void Visit(ExecuteStatement node)
        {
            // Opaque : proc ou SQL dynamique — le contenu peut écrire n'importe où.
            var entity = node.ExecuteSpecification?.ExecutableEntity;
            var target = entity is ExecutableProcedureReference procRef
                ? string.Join(".", procRef.ProcedureReference?.ProcedureReference?.Name?.Identifiers
                      .Select(i => i.Value) ?? ["?"])
                : "(SQL dynamique)";
            if (entity is ExecutableProcedureReference && IsAllowed(Validator.Normalize(target)))
                return;
            Violations.Add(new ValidateViolationDto(node.StartLine, "EXEC (opaque)", target));
        }

        private void CheckTarget(TableReference? target, TSqlFragment at, string type)
        {
            switch (target)
            {
                case NamedTableReference named:
                    CheckName(named.SchemaObject.BaseIdentifier.Value, at, type);
                    break;
                case VariableTableReference:
                    break; // variable table : toujours autorisée
            }
        }

        private void CheckName(string name, TSqlFragment at, string type)
        {
            var bare = Validator.Normalize(name);
            if (bare.StartsWith('#') || bare.StartsWith('@') || IsAllowed(bare)) return;
            Violations.Add(new ValidateViolationDto(at.StartLine, type, name));
        }

        private bool IsAllowed(string bare) => whitelist.Contains(bare);
    }
}
