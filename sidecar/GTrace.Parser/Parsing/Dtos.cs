namespace GTrace.Parser.Parsing;

public sealed record StatementDto(
    int Index,
    string Type,
    int Depth,
    int StartLine,
    int StartColumn,
    int EndLine,
    int EndColumn,
    IReadOnlyList<string> DeclaredVariables,
    IReadOnlyList<string> ReferencedVariables);

public sealed record VariableDto(
    string Name,
    string Type,
    int DeclaredAtLine);

public sealed record ParseErrorDto(
    int Number,
    int Line,
    int Column,
    string Message);

public sealed record ParseResultDto(
    IReadOnlyList<StatementDto> Statements,
    IReadOnlyList<VariableDto> Variables,
    IReadOnlyList<ParseErrorDto> Errors);
