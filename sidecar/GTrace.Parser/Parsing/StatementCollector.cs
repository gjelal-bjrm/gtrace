using Microsoft.SqlServer.TransactSql.ScriptDom;

namespace GTrace.Parser.Parsing;

/// <summary>
/// Collecte, en ordre de document, chaque statement avec sa position, sa profondeur
/// d'imbrication, les variables déclarées, ainsi que toutes les références de
/// variables (rattachées ensuite au statement englobant le plus interne).
/// </summary>
internal sealed class StatementCollector : TSqlFragmentVisitor
{
    internal sealed class Entry
    {
        public required TSqlStatement Node { get; init; }
        public required int Depth { get; init; }
        public List<string> Declared { get; } = [];
        public List<string> Referenced { get; } = [];
    }

    public List<Entry> Statements { get; } = [];
    public List<VariableDto> Variables { get; } = [];

    private readonly List<VariableReference> _references = [];
    private readonly Stack<Entry> _enclosing = new();

    public override void Visit(TSqlStatement node)
    {
        if (node.FirstTokenIndex < 0) return;

        // Les statements arrivent en pré-ordre : la pile des englobants se purge
        // dès qu'on dépasse la fin (en tokens) du statement au sommet.
        while (_enclosing.Count > 0 && node.FirstTokenIndex > _enclosing.Peek().Node.LastTokenIndex)
            _enclosing.Pop();

        var entry = new Entry { Node = node, Depth = _enclosing.Count };
        Statements.Add(entry);
        _enclosing.Push(entry);

        switch (node)
        {
            case DeclareVariableStatement declare:
                foreach (var element in declare.Declarations)
                {
                    var name = element.VariableName.Value;
                    entry.Declared.Add(name);
                    Variables.Add(new VariableDto(
                        name,
                        FragmentText(element.DataType) is { Length: > 0 } t ? t : "?",
                        element.StartLine));
                }
                break;

            case DeclareTableVariableStatement tableVar:
                var tvName = tableVar.Body.VariableName.Value;
                entry.Declared.Add(tvName);
                Variables.Add(new VariableDto(tvName, "TABLE", tableVar.StartLine));
                break;

            case ProcedureStatementBody procBody when procBody.ProcedureReference != null:
                foreach (var param in procBody.Parameters)
                {
                    Variables.Add(new VariableDto(
                        param.VariableName.Value,
                        FragmentText(param.DataType) is { Length: > 0 } pt ? pt : "?",
                        param.StartLine));
                }
                break;
        }
    }

    public override void Visit(VariableReference node)
    {
        if (node.FirstTokenIndex >= 0) _references.Add(node);
    }

    /// <summary>Rattache chaque référence de variable au statement englobant le plus interne.</summary>
    public void ResolveReferences()
    {
        foreach (var reference in _references)
        {
            Entry? innermost = null;
            foreach (var entry in Statements)
            {
                if (entry.Node.FirstTokenIndex <= reference.FirstTokenIndex &&
                    entry.Node.LastTokenIndex >= reference.FirstTokenIndex)
                {
                    innermost = entry; // les statements sont en pré-ordre : le dernier qui contient gagne
                }
            }
            if (innermost != null && !innermost.Referenced.Contains(reference.Name))
                innermost.Referenced.Add(reference.Name);
        }
    }

    private static string FragmentText(TSqlFragment? fragment) => FragmentUtils.GetText(fragment);
}
