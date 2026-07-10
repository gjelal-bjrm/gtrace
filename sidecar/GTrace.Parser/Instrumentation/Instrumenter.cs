using System.Text;
using System.Text.Json;
using GTrace.Parser.Parsing;
using Microsoft.SqlServer.TransactSql.ScriptDom;

namespace GTrace.Parser.Instrumentation;

/// <summary>
/// Instrumentation par splicing textuel : les appels de trace sont insérés sur la
/// même ligne que le statement qu'ils suivent — le script instrumenté garde
/// exactement le même nombre de lignes que le source original, donc ERROR_LINE()
/// et la table de correspondance mappent directement sur le source.
/// </summary>
/// <summary>Options d'injection des breakpoints simulés (Phase 2).</summary>
public sealed record PauseOptions(
    string SessionId,
    IReadOnlySet<int> Breakpoints,
    string ControlTable);

public static class Instrumenter
{
    public const string TraceTag = "__GTRACE__";
    public const string ErrorTag = "__GTRACE_ERR__";
    public const string PauseTag = "__GTRACE_PAUSE__";
    public const string SnapTag = "__GTRACE_SNAP__";
    private const int SnapshotMaxRows = 1000;

    public static InstrumentResultDto Handle(JsonElement parameters)
    {
        var sql = parameters.GetProperty("sql").GetString() ?? string.Empty;
        var compatLevel = parameters.TryGetProperty("compatLevel", out var c) ? c.GetInt32() : 150;

        PauseOptions? pause = null;
        if (parameters.TryGetProperty("pause", out var p) && p.ValueKind == JsonValueKind.Object)
        {
            // Le GUID est reparsé et le nom de table filtré : ces valeurs sont
            // concaténées dans du SQL, on n'y laisse passer aucun texte libre.
            var sessionId = Guid.Parse(p.GetProperty("sessionId").GetString()!);
            var breakpoints = p.TryGetProperty("breakpoints", out var b)
                ? b.EnumerateArray().Select(x => x.GetInt32()).ToHashSet()
                : [];
            var table = p.TryGetProperty("controlTable", out var t)
                ? t.GetString() ?? "GTraceDB.dbo.ControlSignal"
                : "GTraceDB.dbo.ControlSignal";
            if (!System.Text.RegularExpressions.Regex.IsMatch(table, @"^[A-Za-z0-9_\.\[\]]+$"))
                throw new ArgumentException($"Nom de table de contrôle invalide : {table}");
            pause = new PauseOptions(sessionId.ToString("D"), breakpoints, table);
        }

        var snapshots = new List<string>();
        if (parameters.TryGetProperty("snapshots", out var snaps) && snaps.ValueKind == JsonValueKind.Array)
        {
            foreach (var s in snaps.EnumerateArray())
            {
                var name = s.GetString();
                if (string.IsNullOrWhiteSpace(name)) continue;
                // Concaténé dans du SQL : uniquement des noms d'objets plausibles.
                if (!System.Text.RegularExpressions.Regex.IsMatch(name, @"^[#@\w\[\]\.]+$"))
                    throw new ArgumentException($"Nom de table de snapshot invalide : {name}");
                snapshots.Add(name);
            }
        }

        return Instrument(sql, compatLevel, pause, snapshots);
    }

    public static InstrumentResultDto Instrument(
        string sql,
        int compatLevel = 150,
        PauseOptions? pause = null,
        IReadOnlyList<string>? snapshots = null)
    {
        var parser = ParserFactory.Create(compatLevel);
        var fragment = parser.Parse(new StringReader(sql), out var parseErrors);
        var errors = parseErrors
            .Select(e => new ParseErrorDto(e.Number, e.Line, e.Column, e.Message))
            .ToList();

        if (errors.Count > 0 || fragment is not TSqlScript script)
            return Failure(errors, "Le source ne parse pas.");
        if (script.Batches.Count != 1)
            return Failure(errors,
                $"Un seul batch attendu, {script.Batches.Count} trouvés (séparateur GO non supporté).");

        var batch = script.Batches[0];
        var ctx = new Context(sql) { Pause = pause, SnapshotTargets = snapshots ?? [] };

        if (pause != null)
        {
            // Préambule (aucune ligne ajoutée) : compteur d'exécution + id de session.
            ctx.Insert(0,
                $"DECLARE @__gt_seq int = 0; DECLARE @__gt_sid uniqueidentifier = '{pause.SessionId}'; ");
        }

        string? procName = null;
        string? paramsDecl = null;
        var procParams = new List<ProcParameterDto>();
        IList<TSqlStatement> topStatements;

        if (batch.Statements.Count == 1 && batch.Statements[0] is ProcedureStatementBody proc)
        {
            var body = proc.StatementList;
            if (body == null || body.Statements.Count == 0)
                return Failure(errors, "Corps de procédure vide.");

            topStatements = body.Statements;
            procName = string.Join(".", proc.ProcedureReference.Name.Identifiers.Select(i => i.Value));

            foreach (var p in proc.Parameters)
            {
                var type = FragmentUtils.GetText(p.DataType);
                procParams.Add(new ProcParameterDto(
                    p.VariableName.Value,
                    type.Length > 0 ? type : "?",
                    p.Modifier == ParameterModifier.Output,
                    p.Value != null,
                    p.Value != null ? FragmentUtils.GetText(p.Value) : null));
            }
            paramsDecl = string.Join(", ",
                procParams.Select(p => $"{p.Name} {p.Type}{(p.IsOutput ? " OUTPUT" : "")}"));
            // Les RETURN sortent du batch : chaque trace de RETURN embarque l'état
            // final des paramètres OUTPUT pour qu'il ne soit jamais perdu.
            ctx.OutputParams = procParams.Where(p => p.IsOutput).Select(p => p.Name).ToList();

            // Le corps devient un script anonyme : l'en-tête CREATE PROCEDURE … AS est
            // blanchi (les retours à la ligne sont préservés → les lignes ne bougent pas).
            ctx.Blank(0, topStatements[0].StartOffset);
            ctx.Blank(FragmentUtils.EndOffset(topStatements[^1]), sql.Length);
        }
        else
        {
            topStatements = batch.Statements;
        }

        InstrumentList(topStatements, null, ctx, 0);

        return new InstrumentResultDto(ctx.Apply(), procName, paramsDecl, procParams, ctx.Map, errors);
    }

    private static InstrumentResultDto Failure(List<ParseErrorDto> errors, string message)
    {
        if (errors.Count == 0) errors.Add(new ParseErrorDto(0, 1, 1, message));
        return new InstrumentResultDto(string.Empty, null, null, [], [], errors);
    }

    /// <param name="loopClosing">
    /// WHILE dont la condition est réévaluée immédiatement après le dernier statement
    /// de la liste — sa condition ne doit pas lire un @@ROWCOUNT corrompu par une trace.
    /// </param>
    private static void InstrumentList(
        IList<TSqlStatement> statements, WhileStatement? loopClosing, Context ctx, int depth)
    {
        for (var i = 0; i < statements.Count; i++)
        {
            var next = i + 1 < statements.Count ? statements[i + 1] : null;
            var closing = i == statements.Count - 1 ? loopClosing : null;
            ProcessStatement(statements[i], next, closing, ctx, depth);
        }
    }

    private static void ProcessStatement(
        TSqlStatement stmt, TSqlStatement? next, WhileStatement? loopClosing, Context ctx, int depth)
    {
        switch (stmt)
        {
            case BeginEndBlockStatement block:
                ctx.AddMapEntry(stmt, depth, "container", traced: false, "conteneur");
                InstrumentList(block.StatementList.Statements, loopClosing, ctx, depth + 1);
                return;

            case IfStatement ifStmt:
                ctx.AddMapEntry(stmt, depth, "container", traced: false, "conteneur");
                HandleBranch(ifStmt.ThenStatement, loopClosing, ctx, depth + 1);
                if (ifStmt.ElseStatement != null)
                    HandleBranch(ifStmt.ElseStatement, loopClosing, ctx, depth + 1);
                return;

            case WhileStatement whileStmt:
                ctx.AddMapEntry(stmt, depth, "container", traced: false, "conteneur");
                HandleBranch(whileStmt.Statement, whileStmt, ctx, depth + 1);
                return;

            case TryCatchStatement tryCatch:
                ctx.AddMapEntry(stmt, depth, "container", traced: false, "conteneur");
                InstrumentList(tryCatch.TryStatements.Statements, loopClosing, ctx, depth + 1);
                InjectCatchEntry(tryCatch, ctx, depth + 1);
                InstrumentList(tryCatch.CatchStatements.Statements, loopClosing, ctx, depth + 1);
                return;

            case ReturnStatement ret:
                HandleReturn(ret, ctx, depth);
                return;

            case ThrowStatement or BreakStatement or ContinueStatement or GoToStatement:
                // Transfert de contrôle : une trace après serait du code mort → trace AVANT.
                var index = ctx.AddMapEntry(stmt, depth, "statement", traced: true, null);
                InsertPauseBlock(stmt, index, ctx);
                ctx.Insert(stmt.StartOffset, TraceSelect(index, []) + " ");
                return;

            default:
                HandleLeaf(stmt, next, loopClosing, ctx, depth);
                return;
        }
    }

    private static void HandleBranch(
        TSqlStatement body, WhileStatement? loopClosing, Context ctx, int depth)
    {
        if (body is BeginEndBlockStatement)
        {
            ProcessStatement(body, null, loopClosing, ctx, depth);
            return;
        }
        // Corps à statement unique : enveloppé de BEGIN … END inline (aucune ligne ajoutée)
        // pour pouvoir y injecter une trace.
        ctx.Insert(body.StartOffset, "BEGIN ");
        ProcessStatement(body, null, loopClosing, ctx, depth);
        ctx.Insert(FragmentUtils.EndOffset(body), " END ");
    }

    private static void HandleLeaf(
        TSqlStatement stmt, TSqlStatement? next, WhileStatement? loopClosing, Context ctx, int depth)
    {
        string? skipReason = null;
        if (next != null && ReadsRowcountOrError(next))
            skipReason = "le statement suivant lit @@ROWCOUNT/@@ERROR";
        else if (loopClosing != null && ReadsRowcountOrError(loopClosing.Predicate))
            skipReason = "la condition du WHILE englobant lit @@ROWCOUNT/@@ERROR";

        var traced = skipReason == null;
        var index = ctx.AddMapEntry(stmt, depth, "statement", traced, skipReason);
        if (!traced) return;

        InsertPauseBlock(stmt, index, ctx);
        var separator = FragmentUtils.EndsWithSemicolon(stmt) ? " " : ";";
        ctx.Insert(FragmentUtils.EndOffset(stmt), separator + TraceSelect(index, WrittenVariables(stmt)));
        InsertSnapshots(stmt, index, ctx);
    }

    private static void HandleReturn(ReturnStatement ret, Context ctx, int depth)
    {
        var index = ctx.AddMapEntry(ret, depth, "statement", traced: true, null);
        InsertPauseBlock(ret, index, ctx);

        if (ret.Expression == null)
        {
            ctx.Insert(ret.StartOffset, TraceSelect(index, ctx.OutputParams) + " ");
            return;
        }

        // RETURN <expr> est invalide dans un batch anonyme : remplacé par une trace
        // qui capture la valeur (_ret) suivie d'un RETURN nu. Le statement original
        // est blanchi (retours à la ligne préservés).
        var exprText = FragmentUtils.GetText(ret.Expression);
        var outputCols = string.Concat(ctx.OutputParams.Select(p => $", {p} AS [{p}]"));
        ctx.Blank(ret.StartOffset, FragmentUtils.EndOffset(ret));
        ctx.Insert(ret.StartOffset,
            $"SELECT '{TraceTag}' AS _t, {index} AS _s, @@ROWCOUNT AS _rc, SYSDATETIME() AS _ts, ({exprText}) AS _ret{outputCols}; RETURN; ");
    }

    private static void InjectCatchEntry(TryCatchStatement tryCatch, Context ctx, int depth)
    {
        var statements = tryCatch.CatchStatements.Statements;
        if (statements.Count == 0) return;

        var first = statements[0];
        var index = ctx.AddMapEntryRaw(
            "CatchBlock", depth, "catchEntry", first.StartLine, first.StartLine, traced: true, null);
        ctx.Insert(first.StartOffset,
            $"SELECT '{ErrorTag}' AS _t, {index} AS _s, SYSDATETIME() AS _ts, " +
            "ERROR_NUMBER() AS _errnum, ERROR_MESSAGE() AS _errmsg, ERROR_LINE() AS _errline, " +
            "ERROR_SEVERITY() AS _errsev, ERROR_STATE() AS _errstate; ");
    }

    /// <summary>
    /// Bloc de pause (breakpoints simulés) inséré AVANT le statement. Le compteur
    /// @__gt_seq est incrémenté à chaque point de pause : le driver pilote via la
    /// ligne ControlSignal (GoUntilSeq / RunToBreakpoint). Quand l'exécution attend
    /// réellement, un resultset __GTRACE_PAUSE__ est émis (seq, statement, @@TRANCOUNT)
    /// pour notifier le client en streaming.
    /// Pas de bloc si le statement lit @@ROWCOUNT/@@ERROR (le bloc les corromprait).
    /// </summary>
    private static void InsertPauseBlock(TSqlStatement stmt, int index, Context ctx)
    {
        var pause = ctx.Pause;
        if (pause == null || ReadsRowcountOrError(stmt)) return;

        var bypass = pause.Breakpoints.Contains(index) ? "" : " OR RunToBreakpoint = 1";
        var condition =
            $"NOT EXISTS (SELECT 1 FROM {pause.ControlTable} " +
            $"WHERE SessionId = @__gt_sid AND (GoUntilSeq >= @__gt_seq{bypass}))";

        // Le RAISERROR … WITH NOWAIT force le flush du buffer TDS : sans lui, le
        // resultset du marqueur resterait bufferisé côté serveur pendant le WAITFOR
        // et le client ne saurait jamais que l'exécution est en pause.
        ctx.Insert(stmt.StartOffset,
            $"SET @__gt_seq = @__gt_seq + 1; IF {condition} BEGIN " +
            $"SELECT '{PauseTag}' AS _t, @__gt_seq AS _seq, {index} AS _s, @@TRANCOUNT AS _tc; " +
            $"RAISERROR(N'', 0, 1) WITH NOWAIT; " +
            $"WHILE {condition} WAITFOR DELAY '00:00:00.250'; END ");
    }

    /// <summary>
    /// Snapshots de tables (spec Phase 4) : après chaque statement qui écrit dans
    /// une table ciblée, son contenu est streamé en resultset tagué — même
    /// mécanique que les traces (aucune écriture, survit aux ROLLBACK, fonctionne
    /// pour #temp et variables tables invisibles depuis une autre connexion).
    /// Inséré APRÈS la trace (le SELECT du snapshot réinitialise @@ROWCOUNT).
    /// </summary>
    private static void InsertSnapshots(TSqlStatement stmt, int index, Context ctx)
    {
        if (ctx.SnapshotTargets.Count == 0) return;

        var written = WrittenTables(stmt);
        if (written.Count == 0) return;

        foreach (var target in ctx.SnapshotTargets)
        {
            var bare = NormalizeTableName(target);
            if (!written.Contains(bare)) continue;
            // Deux resultsets : un en-tête (toujours 1 ligne, même si la table est
            // vide) puis le contenu — le client les apparie.
            ctx.Insert(FragmentUtils.EndOffset(stmt),
                $" SELECT '{SnapTag}' AS _t, {index} AS _s, N'{target.Replace("'", "''")}' AS _tbl; " +
                $"SELECT TOP ({SnapshotMaxRows}) * FROM {target};");
        }
    }

    private static string NormalizeTableName(string name)
    {
        var last = name.Split('.')[^1];
        return last.Replace("[", "").Replace("]", "").ToLowerInvariant();
    }

    /// <summary>Noms (non qualifiés, normalisés) des tables écrites par le statement.</summary>
    private static HashSet<string> WrittenTables(TSqlStatement stmt)
    {
        var visitor = new WrittenTablesVisitor();
        stmt.Accept(visitor);
        return visitor.Names;
    }

    private static string TraceSelect(int index, IReadOnlyCollection<string> variables)
    {
        var sb = new StringBuilder();
        sb.Append("SELECT '").Append(TraceTag).Append("' AS _t, ")
          .Append(index).Append(" AS _s, @@ROWCOUNT AS _rc, SYSDATETIME() AS _ts");
        foreach (var variable in variables)
            sb.Append(", ").Append(variable).Append(" AS [").Append(variable).Append(']');
        sb.Append(';');
        return sb.ToString();
    }

    private static bool ReadsRowcountOrError(TSqlFragment fragment)
    {
        var visitor = new GlobalVarReaderVisitor();
        fragment.Accept(visitor);
        return visitor.Found;
    }

    private static IReadOnlyCollection<string> WrittenVariables(TSqlStatement stmt)
    {
        var visitor = new WrittenVariablesVisitor();
        stmt.Accept(visitor);
        return visitor.Names;
    }

    private sealed class GlobalVarReaderVisitor : TSqlFragmentVisitor
    {
        public bool Found;

        public override void Visit(GlobalVariableExpression node)
        {
            if (node.Name.Equals("@@ROWCOUNT", StringComparison.OrdinalIgnoreCase) ||
                node.Name.Equals("@@ERROR", StringComparison.OrdinalIgnoreCase))
            {
                Found = true;
            }
        }
    }

    /// <summary>Tables cibles des écritures (INSERT/UPDATE/DELETE/MERGE/SELECT INTO).</summary>
    private sealed class WrittenTablesVisitor : TSqlFragmentVisitor
    {
        public HashSet<string> Names { get; } = new(StringComparer.Ordinal);

        public override void Visit(InsertSpecification node) => Add(node.Target);
        public override void Visit(UpdateSpecification node) => Add(node.Target);
        public override void Visit(DeleteSpecification node) => Add(node.Target);
        public override void Visit(MergeSpecification node) => Add(node.Target);

        public override void Visit(SelectStatement node)
        {
            if (node.Into != null) Names.Add(Normalize(node.Into.BaseIdentifier.Value));
        }

        private void Add(TableReference? target)
        {
            switch (target)
            {
                case NamedTableReference named:
                    Names.Add(Normalize(named.SchemaObject.BaseIdentifier.Value));
                    break;
                case VariableTableReference variable:
                    Names.Add(Normalize(variable.Variable.Name));
                    break;
            }
        }

        private static string Normalize(string name) =>
            name.Replace("[", "").Replace("]", "").ToLowerInvariant();
    }

    /// <summary>Variables scalaires potentiellement écrites par un statement.</summary>
    private sealed class WrittenVariablesVisitor : TSqlFragmentVisitor
    {
        public HashSet<string> Names { get; } = new(StringComparer.OrdinalIgnoreCase);

        public override void Visit(SetVariableStatement node) => Names.Add(node.Variable.Name);
        public override void Visit(SelectSetVariable node) => Names.Add(node.Variable.Name);
        public override void Visit(DeclareVariableElement node) => Names.Add(node.VariableName.Value);

        public override void Visit(FetchCursorStatement node)
        {
            foreach (var variable in node.IntoVariables) Names.Add(variable.Name);
        }

        public override void Visit(ExecuteSpecification node)
        {
            if (node.Variable != null) Names.Add(node.Variable.Name);
        }

        public override void Visit(ExecuteParameter node)
        {
            if (node.IsOutput && node.ParameterValue is VariableReference variable)
                Names.Add(variable.Name);
        }
    }

    /// <summary>
    /// Accumule les éditions (insertions à offset fixe + blanchiments) puis les
    /// applique en une passe. Les insertions au même offset sont concaténées dans
    /// l'ordre de création. Les blanchiments préservent les retours à la ligne.
    /// </summary>
    private sealed class Context(string sql)
    {
        private readonly List<(int Offset, string Text)> _inserts = [];
        private readonly List<(int Start, int End)> _blanks = [];

        public IReadOnlyList<string> OutputParams { get; set; } = [];
        public PauseOptions? Pause { get; init; }
        public IReadOnlyList<string> SnapshotTargets { get; init; } = [];
        public List<InstrumentedStatementDto> Map { get; } = [];

        public void Insert(int offset, string text) => _inserts.Add((offset, text));

        public void Blank(int start, int end)
        {
            if (end > start) _blanks.Add((start, end));
        }

        public int AddMapEntry(TSqlStatement stmt, int depth, string kind, bool traced, string? skipReason)
        {
            var (endLine, _) = FragmentUtils.EndPosition(stmt);
            return AddMapEntryRaw(stmt.GetType().Name, depth, kind, stmt.StartLine, endLine, traced, skipReason);
        }

        public int AddMapEntryRaw(
            string type, int depth, string kind, int startLine, int endLine, bool traced, string? skipReason)
        {
            var index = Map.Count;
            Map.Add(new InstrumentedStatementDto(index, type, kind, depth, startLine, endLine, traced, skipReason));
            return index;
        }

        public string Apply()
        {
            var chars = sql.ToCharArray();
            foreach (var (start, end) in _blanks)
            {
                for (var i = start; i < end && i < chars.Length; i++)
                {
                    if (chars[i] != '\n' && chars[i] != '\r') chars[i] = ' ';
                }
            }

            var byOffset = _inserts
                .GroupBy(e => e.Offset)
                .ToDictionary(g => g.Key, g => string.Concat(g.Select(e => e.Text)));

            var sb = new StringBuilder(sql.Length + _inserts.Sum(e => e.Text.Length));
            for (var i = 0; i < chars.Length; i++)
            {
                if (byOffset.TryGetValue(i, out var text)) sb.Append(text);
                sb.Append(chars[i]);
            }
            if (byOffset.TryGetValue(chars.Length, out var tail)) sb.Append(tail);
            return sb.ToString();
        }
    }
}
