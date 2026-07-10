using System.Text;
using Microsoft.SqlServer.TransactSql.ScriptDom;

namespace GTrace.Parser.Parsing;

public static class FragmentUtils
{
    /// <summary>Texte source exact d'un fragment, reconstruit depuis ses tokens.</summary>
    public static string GetText(TSqlFragment? fragment)
    {
        if (fragment == null || fragment.FirstTokenIndex < 0) return string.Empty;
        var sb = new StringBuilder();
        for (var i = fragment.FirstTokenIndex; i <= fragment.LastTokenIndex; i++)
            sb.Append(fragment.ScriptTokenStream[i].Text);
        return sb.ToString();
    }

    /// <summary>Offset (0-based) du caractère qui suit le dernier token du fragment.</summary>
    public static int EndOffset(TSqlFragment fragment)
    {
        var token = fragment.ScriptTokenStream[fragment.LastTokenIndex];
        return token.Offset + (token.Text?.Length ?? 0);
    }

    /// <summary>
    /// Position (ligne, colonne 1-based du dernier caractère) de fin d'un fragment,
    /// calculée depuis son dernier token — ScriptDom n'expose que le début.
    /// </summary>
    public static (int Line, int Column) EndPosition(TSqlFragment fragment)
    {
        if (fragment.LastTokenIndex < 0) return (fragment.StartLine, fragment.StartColumn);

        var token = fragment.ScriptTokenStream[fragment.LastTokenIndex];
        var text = token.Text ?? string.Empty;
        var lastNewline = text.LastIndexOf('\n');

        if (lastNewline < 0)
            return (token.Line, token.Column + Math.Max(text.Length - 1, 0));

        var extraLines = text.Count(ch => ch == '\n');
        return (token.Line + extraLines, text.Length - lastNewline - 1);
    }

    /// <summary>Vrai si le dernier token du fragment est un point-virgule.</summary>
    public static bool EndsWithSemicolon(TSqlFragment fragment) =>
        fragment.LastTokenIndex >= 0 &&
        fragment.ScriptTokenStream[fragment.LastTokenIndex].TokenType == TSqlTokenType.Semicolon;
}
