\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{tietreport}

\LoadClass[12pt,a4paper,oneside]{report}

\RequirePackage[
    a4paper,
    top=0.72in,
    bottom=0.78in,
    left=0.82in,
    right=0.82in,
    headheight=15pt,
    headsep=0.18in
]{geometry}

\RequirePackage{graphicx}
\RequirePackage{float}
\RequirePackage{amsmath}
\RequirePackage{booktabs}
\RequirePackage{tabularx}
\RequirePackage{setspace}
\RequirePackage{enumitem}
\RequirePackage{titlesec}
\RequirePackage{fancyhdr}
\RequirePackage{caption}
\RequirePackage{hyperref}
\RequirePackage{newtxtext}
\RequirePackage{newtxmath}

\onehalfspacing

\setlength{\parindent}{0pt}
\setlength{\parskip}{3pt}

% ---------------- HEADER ----------------

\pagestyle{fancy}

\fancyhf{}

\fancyhead[L]{
    \small\thepage\quad UCS503P - Software Engineering Project
}

\renewcommand{\headrulewidth}{0.5pt}

\fancypagestyle{plain}{
    \fancyhf{}
    \fancyhead[L]{
        \small\thepage\quad UCS503P - Software Engineering Project
    }
    \renewcommand{\headrulewidth}{0.5pt}
}

% ---------------- CHAPTER ----------------

\titleformat{\chapter}
    [display]
    {\normalfont\bfseries\centering}
    {\Large Chapter \thechapter}
    {5pt}
    {\Huge}

\titlespacing*{\chapter}
    {0pt}
    {-8pt}
    {18pt}

% ---------------- SECTIONS ----------------

\titleformat{\section}
    {\normalfont\Large\bfseries}
    {\thesection}
    {0.7em}
    {}

\titleformat{\subsection}
    {\normalfont\large\bfseries}
    {\thesubsection}
    {0.7em}
    {}

\titlespacing*{\section}{0pt}{8pt}{3pt}
\titlespacing*{\subsection}{0pt}{5pt}{2pt}

% ---------------- FIGURES ----------------

\captionsetup{
    font=small,
    labelfont=bf,
    justification=centering,
    skip=5pt
}

% ---------------- LISTS ----------------

\setlist[itemize]{
    leftmargin=0.3in,
    itemsep=1pt,
    topsep=2pt
}

\setlist[enumerate]{
    leftmargin=0.3in,
    itemsep=1pt,
    topsep=2pt
}

\renewcommand{\arraystretch}{1.1}

% ---------------- LINKS ----------------

\hypersetup{
    colorlinks=false,
    hidelinks
}

% ---------------- TITLE PAGE ----------------

\newcommand{\TitlePageHeader}[1]{\def\TIETHeader{#1}}
\newcommand{\ProjectTitle}[1]{\def\TIETProjectTitle{#1}}
\newcommand{\ProjectSubtitle}[1]{\def\TIETProjectSubtitle{#1}}
\newcommand{\AdvisorName}[1]{\def\TIETAdvisor{#1}}
\newcommand{\TitlePageSubText}[1]{\def\TIETSubText{#1}}
\newcommand{\TitlePageFooterText}[1]{\def\TIETFooter{#1}}

\def\TIETHeader{}
\def\TIETProjectTitle{}
\def\TIETProjectSubtitle{}
\def\TIETAdvisor{}
\def\TIETSubText{}
\def\TIETFooter{}

\newcommand{\maketiettitle}{

\begin{titlepage}

\thispagestyle{empty}

\begin{center}

\vspace*{0.35in}

{\large\bfseries
\TIETHeader
}

\vspace{0.55in}

{\LARGE\bfseries
\TIETProjectTitle
}

\vspace{0.12in}

{\large
\TIETProjectSubtitle
}

\vspace{0.42in}

{\large
\TIETSubText
}

\vspace{0.15in}

\begin{tabular}{ll}
1024170440 & Lakshita Dabra\\
1024170448 & Rhythm Kapila\\
1024170452 & Yashjot Kaur
\end{tabular}

\vspace{0.22in}

{\large
\textbf{Group:} BE Third Year, CSE
}

\vspace{0.25in}

{\large
\textbf{Submitted to:}\\[4pt]
\TIETAdvisor
}

\vfill

{\large
\TIETFooter
}

\end{center}

\end{titlepage}

}

\endinput