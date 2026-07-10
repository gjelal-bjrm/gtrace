using GTrace.Parser.Parsing;

namespace GTrace.Parser.Instrumentation;

/// <summary>Entrée de la table de correspondance statementIndex ↔ lignes du source original.</summary>
public sealed record InstrumentedStatementDto(
    int Index,
    string Type,
    /// <summary>"statement" | "container" | "catchEntry"</summary>
    string Kind,
    int Depth,
    int StartLine,
    int EndLine,
    bool Traced,
    string? SkipReason);

public sealed record ProcParameterDto(
    string Name,
    string Type,
    bool IsOutput,
    bool HasDefault,
    string? DefaultText);

public sealed record InstrumentResultDto(
    string Script,
    string? ProcedureName,
    string? ParamsDeclaration,
    IReadOnlyList<ProcParameterDto> Parameters,
    IReadOnlyList<InstrumentedStatementDto> Statements,
    IReadOnlyList<ParseErrorDto> Errors);
