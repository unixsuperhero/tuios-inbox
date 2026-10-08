# Sourced from ~/.bashrc by setup-cross-host. Marks commands with OSC 133 for tuios run.
# Same marks as the recipe in `tuios doctor shell`; bash 4.4+ is needed because older bash ignores PS0.
[[ $- == *i* && ${TUIOS_ENV:-} == 1 ]] || return 0
(( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) )) || return 0
[[ ${_TUIOS_INBOX_OSC133:-} == 1 ]] && return 0
_TUIOS_INBOX_OSC133=1

# A personal bashrc that already carries the native marks keeps them; each mark is added at most once.
_tuios_inbox_pc='printf "\e]133;D;%s\a\e]133;A\a" "$?"'
if [[ $(declare -p PROMPT_COMMAND 2>/dev/null) == "declare -a"* ]]; then
  [[ ${PROMPT_COMMAND[*]} == *'133;A'* ]] || PROMPT_COMMAND=("$_tuios_inbox_pc" "${PROMPT_COMMAND[@]}")
else
  [[ ${PROMPT_COMMAND:-} == *'133;A'* ]] || PROMPT_COMMAND=$_tuios_inbox_pc${PROMPT_COMMAND:+";$PROMPT_COMMAND"}
fi
unset _tuios_inbox_pc
[[ ${PS0:-} == *'133;C'* ]] || PS0+='\e]133;C\a'
[[ ${PS1:-} == *'133;B'* ]] || PS1+='\[\e]133;B\a\]'
